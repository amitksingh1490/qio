export enum Status {
  Failure,
  Success,
  Pending
}

export type Exit<E, A> =
  | [Status.Success, A]
  | [Status.Failure, E]
  | [Status.Pending]

export const Exit = {
  ...Status,
  failure: <E>(e: E): Exit<E, never> => [Status.Failure, e],
  isFailure: <E, A>(x: Exit<E, A>): x is [Status.Failure, E] =>
    x[0] === Status.Failure,
  isPending: <E, A>(x: Exit<E, A>): x is [Status.Pending] =>
    x[0] === Status.Pending,
  isSuccess: <E, A>(x: Exit<E, A>): x is [Status.Success, A] =>
    x[0] === Status.Success,
  pending: [Status.Pending] as Exit<never, never>,
  success: <A>(a: A): Exit<never, A> => [Status.Success, a]
}
