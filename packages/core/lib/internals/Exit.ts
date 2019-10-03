import {ICancellable} from 'ts-scheduler'

import {IRuntime} from '../core'
import {UIO} from '../main/FIO'

export class Exit implements ICancellable {
  public constructor(
    private readonly uio: UIO<void>,
    private readonly runtime: IRuntime
  ) {}

  public cancel(): void {
    this.runtime.execute(this.uio)
  }
}