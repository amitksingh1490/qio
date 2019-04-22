import {LinkedList} from 'dbl-linked-list-ds'
import {Cancel} from 'ts-scheduler'

import {SchedulerEnv} from '../envs/SchedulerEnv'
import {FIO} from '../internals/FIO'
import {REJ} from '../internals/REJ'
import {RES} from '../internals/RES'

/**
 * @ignore
 */
export class Once<R, A> implements FIO<R & SchedulerEnv, A> {
  private cancel: Cancel | undefined
  private error: Error | undefined
  private isForked = false
  private isRejected = false
  private isResolved = false
  private readonly Q = new LinkedList<{rej: REJ; res: RES<A>}>()
  private result: A | undefined

  public constructor(private readonly io: FIO<R, A>) {}

  public fork(env: R & SchedulerEnv, rej: REJ, res: RES<A>): Cancel {
    const sh = env.scheduler
    if (this.isResolved) {
      return sh.asap(() => res(this.result as A))
    }

    if (this.isRejected) {
      return sh.asap(() => rej(this.error as Error))
    }

    const id = this.Q.add({res, rej})

    if (!this.isForked) {
      this.isForked = true
      this.cancel = this.io.fork(env, this.onReject, this.onResolve)
    }

    return () => {
      this.Q.remove(id)
      if (this.Q.length === 0 && typeof this.cancel === 'function') {
        this.cancel()
      }
    }
  }

  private readonly onReject = (err: Error) => {
    this.isRejected = true
    this.error = err
    this.Q.forEach(_ => _.value.rej(err))
  }

  private readonly onResolve = (a: A) => {
    this.result = a
    this.isResolved = true
    this.Q.forEach(_ => _.value.res(a))
  }
}