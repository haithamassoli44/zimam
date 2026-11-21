import { ref } from 'vue'

/** The time, a minute at most behind, so relative times on screen move on by themselves. */
export const now = ref(Date.now())
setInterval(() => (now.value = Date.now()), 60_000)
