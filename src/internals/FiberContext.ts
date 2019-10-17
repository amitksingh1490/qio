/* tslint:disable: no-unbound-method cyclomatic-complexity */

import {check} from 'checked-exceptions'
import {
  DoublyLinkedList,
  Either,
  LinkedListNode,
  Option
} from 'standard-data-structures'
import {ICancellable, IScheduler} from 'ts-scheduler'

import {FIO, IO, UIO} from '../main/FIO'
import {IFiber} from '../main/IFiber'
import {Instruction, Tag} from '../main/Instructions'

import {CancellationList} from './CancellationList'
import {CBOption} from './CBOption'

const InvalidInstruction = check(
  'InvalidInstruction',
  (ins: Instruction) => `${Tag[ins.tag]}`
)

enum FiberStatus {
  PENDING,
  COMPLETED,
  CANCELLED
}

/**
 * FiberContext actually evaluates the FIO expression.
 * Its creation is effectful.
 * As soon as its created it starts to evaluate the FIO expression.
 * It provides public APIs to [[Fiber]] to consume.
 */
export class FiberContext<E, A> implements ICancellable, IFiber<E, A> {
  public get abort(): UIO<void> {
    return UIO(() => this.cancel())
  }
  public get await(): UIO<Option<Either<E, A>>> {
    return FIO.asyncUIO(cb => this.unsafeObserve(cb))
  }
  public get join(): FIO<E, A> {
    return FIO.asyncIO<E, A>((rej, res) =>
      this.unsafeObserve(ob => ob.map(_ => _.reduce(rej, res)))
    )
  }

  /**
   * Evaluates an IO using the provided scheduler
   */
  public static evaluateWith<E, A>(
    io: IO<E, A>,
    scheduler: IScheduler
  ): FiberContext<E, A> {
    return new FiberContext(io.asInstruction, scheduler)
  }

  private static dispatchResult<E, A>(
    result: Option<Either<E, A>>,
    cb: CBOption<E, A>
  ): void {
    cb(result)
  }

  private readonly cancellationList = new CancellationList()
  private node?: LinkedListNode<ICancellable>
  private readonly observers = DoublyLinkedList.of<CBOption<E, A>>()
  private result: Option<Either<E, A>> = Option.none()
  private readonly stackA = new Array<Instruction>()
  private readonly stackEnv = new Array<unknown>()
  private status = FiberStatus.PENDING

  private constructor(
    instruction: Instruction,
    private readonly scheduler: IScheduler,
    private readonly maxInstructionCount: number = Number.MAX_SAFE_INTEGER
  ) {
    this.stackA.push(instruction)
    this.init()
  }

  public cancel(): void {
    this.status = FiberStatus.CANCELLED
    this.cancellationList.cancel()

    this.observers.map(_ => _(Option.none()))
  }

  public release(p: UIO<void>): UIO<void> {
    return UIO(() => this.unsafeRelease(p))
  }

  public unsafeObserve(cb: CBOption<E, A>): ICancellable {
    if (this.status === FiberStatus.CANCELLED) {
      return this.scheduler.asap(FiberContext.dispatchResult, Option.none(), cb)
    }
    if (this.status === FiberStatus.COMPLETED) {
      return this.scheduler.asap(FiberContext.dispatchResult, this.result, cb)
    }

    const node = this.observers.add(cb)

    return {cancel: () => this.observers.remove(node)}
  }

  private dispatchResult(result: Either<E, A>): void {
    this.status = FiberStatus.COMPLETED
    this.result = Option.some(result)
    this.observers.map(_ => _(this.result))
  }

  private init(data?: unknown): void {
    this.node = this.cancellationList.push(
      this.scheduler.asap(this.unsafeEvaluate.bind(this), data)
    )
  }

  private unsafeEvaluate(ddd?: unknown): void {
    if (this.node !== undefined) {
      this.cancellationList.remove(this.node)
      this.node = undefined
    }

    let data: unknown = ddd
    let count = 0
    while (true) {
      count++
      if (count === this.maxInstructionCount) {
        return this.init(data)
      }
      try {
        const j = this.stackA.pop()

        if (j === undefined) {
          return this.dispatchResult(Either.right(data as A))
        }

        switch (j.tag) {
          case Tag.Constant:
            data = j.i0
            break

          case Tag.Call:
            this.stackA.push(j.i0(...j.i1))
            break

          case Tag.Reject:
            while (
              this.stackA.length > 0 &&
              this.stackA[this.stackA.length - 1].tag !== Tag.Capture
            ) {
              this.stackA.pop()
            }
            const cause = j.i0 as E
            const handler = this.stackA.pop()
            if (handler !== undefined && handler.tag === Tag.Capture) {
              this.stackA.push(handler.i0(cause))
            } else {
              return this.dispatchResult(Either.left(cause))
            }
            break

          case Tag.Try:
            data = j.i0(data)
            break

          case Tag.TryM:
            this.stackA.push(j.i0(data))
            break

          case Tag.Map:
            this.stackA.push(FIO.resume(j.i1).asInstruction)
            this.stackA.push(j.i0)
            break

          case Tag.Capture:
            break

          case Tag.Chain:
            this.stackA.push(FIO.resumeM(j.i1).asInstruction)
            this.stackA.push(j.i0)
            break

          case Tag.Catch:
            this.stackA.push(FIO.capture(j.i1).asInstruction)
            this.stackA.push(j.i0)
            break

          case Tag.Never:
            return

          case Tag.Fork:
            // Using the `new` operator because FiberContext.of() needs an IO.
            // Computation should continue in the background.
            // A new context is created so that computation from that instruction can happen separately.
            // and then join back into the current context.
            // Using the same stack will corrupt it completely.
            const nContext = new FiberContext(j.i0, this.scheduler)
            this.cancellationList.push(nContext)
            data = nContext
            break

          case Tag.Provide:
            this.stackA.push(
              FIO.resume(i => {
                this.stackEnv.pop()

                return i
              }).asInstruction
            )
            this.stackA.push(j.i0)
            this.stackEnv.push(j.i1)
            break

          case Tag.Access:
            const env = this.stackEnv[this.stackEnv.length - 1]
            data = j.i0(env)
            break

          case Tag.Async:
            const id = this.cancellationList.push(
              j.i0(
                err => {
                  this.cancellationList.remove(id)
                  this.stackA.push(FIO.reject(err).asInstruction)
                  this.unsafeEvaluate()
                },
                val => {
                  this.cancellationList.remove(id)
                  this.stackA.push(FIO.of(val).asInstruction)
                  this.unsafeEvaluate()
                }
              )
            )

            return

          default:
            this.stackA.push(
              FIO.reject(new InvalidInstruction(j)).asInstruction
            )
        }
      } catch (e) {
        this.stackA.push(FIO.reject(e).asInstruction)
      }
    }
  }

  private unsafeRelease(p: UIO<void>): void {
    this.cancellationList.push({
      cancel: () => FiberContext.evaluateWith(p, this.scheduler)
    })
  }
}
