import {UIO} from './QIO'

// tslint:disable-next-line: no-console
export const log = (...t: unknown[]) => UIO(() => console.log(...t))
