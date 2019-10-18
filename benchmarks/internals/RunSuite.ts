/* tslint:disable: no-unbound-method */
import {Suite} from 'benchmark'
import {FutureInstance} from 'fluture'

import {Fiber} from '../../src/internals/Fiber'
import {noop} from '../../src/internals/Noop'
import {UIO} from '../../src/main/FIO'

import {PrintLn} from './PrintLn'

export const RunSuite = (
  name: string,
  test: {
    bluebird(): PromiseLike<unknown>
    fio(): UIO<unknown>
    fluture(): FutureInstance<unknown, unknown>
    native?(): void
  }
) => {
  PrintLn('##', name)
  PrintLn('```')
  const suite = new Suite(name)

  if (typeof test.native === 'function') {
    suite.add('Native', () => {
      ;(test as {native(): void}).native()
    })
  }

  suite
    .add(
      'FIO',
      (cb: IDefer) => Fiber.unsafeExecute(test.fio(), () => cb.resolve()),
      {defer: true}
    )
    .add(
      'Fluture',
      (cb: IDefer) => test.fluture().fork(noop, () => cb.resolve()),
      {defer: true}
    )
    .add('bluebird', (cb: IDefer) => test.bluebird().then(() => cb.resolve()), {
      defer: true
    })

    .on('cycle', (event: Event) => {
      PrintLn(String(event.target))
    })

    .on('complete', function(this: Suite): void {
      PrintLn(
        'Fastest is ' +
          this.filter('fastest')
            .map((i: {name: string}) => i.name)
            .join('') +
          '\n```'
      )
    })
    .run()
}
