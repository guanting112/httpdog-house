// The current time in Unix seconds, as a ref that moves. Every "3m ago" on a page reads the same
// one, so they all change together and a page needs only one timer.

const TICK_MS = 5000

const now = ref(Math.floor(Date.now() / 1000))
let timer: ReturnType<typeof setInterval> | undefined

export function useNow(): Readonly<Ref<number>> {
  timer ??= setInterval(() => (now.value = Math.floor(Date.now() / 1000)), TICK_MS)
  return now
}
