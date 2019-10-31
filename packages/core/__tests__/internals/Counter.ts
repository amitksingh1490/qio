import {UIO} from '../../lib/main/QIO'

export class Counter {
  public count = 0
  public inc = (s: number = 1) => UIO(() => (this.count += s))
  public get increased(): boolean {
    return this.count > 0
  }
}
