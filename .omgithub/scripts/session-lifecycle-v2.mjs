import { classifyV2Event, finishedV2Message } from './opencode-v2-api.mjs'

// Serialize cancellation and completion against newest-first session projections.
export class V2LifecycleBridge {
  constructor({ api, lifecycle, sessionID, onError = error => console.error(error.message) }) {
    Object.assign(this, { api, lifecycle, sessionID, onError })
    this.epoch = 0
    this.busy = false
    this.manualStopEpoch = null
    this.busyPromise = Promise.resolve()
  }

  async beforePrompt() {
    this.epoch++
    this.manualStopEpoch = null
    this.busy = true
    this.busyPromise = this.lifecycle.busy()
    await this.busyPromise
  }

  beforeInterrupt() { this.manualStopEpoch = this.epoch }

  async observe(event) {
    const kind = classifyV2Event(event, this.sessionID)
    if (kind === 'busy') {
      if (!this.busy) await this.beforePrompt()
      else await this.busyPromise
      return
    }
    if (kind === 'completed') await this.reconcile()
    if (kind === 'interrupted' && this.manualStopEpoch === this.epoch) {
      this.busy = false
      const epoch = this.epoch
      for (let attempt = 0; attempt < 20 && epoch === this.epoch; attempt++) {
        if (await this.reconcile({ allowInterrupted: true })) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      this.manualStopEpoch = null
      return
    }
    if (kind === 'failed' || kind === 'interrupted') {
      this.epoch++
      this.busy = false
    }
  }

  async reconcile({ allowInterrupted = false } = {}) {
    const epoch = this.epoch
    const snapshot = await this.api.snapshot(this.sessionID)
    if (epoch !== this.epoch) return
    if (snapshot.busy) {
      if (!this.busy && !allowInterrupted) await this.beforePrompt()
      return
    }
    const messageID = finishedV2Message(snapshot, { allowInterrupted })
    if (!messageID) return
    this.busy = false
    Promise.resolve(this.lifecycle.complete(messageID)).catch(this.onError)
    return true
  }

  async follow(signal) {
    // Subscribe before reconciling so an execution transition cannot be lost.
    const stream = this.api.events({ signal })[Symbol.asyncIterator]()
    const first = await stream.next()
    if (first.done || first.value?.type !== 'server.connected') throw new Error('V2 event stream did not connect')
    await this.reconcile()
    while (!signal?.aborted) {
      const next = await stream.next()
      if (next.done) return
      await this.observe(next.value)
    }
  }
}

export function isV2MainPrompt(method, url, sessionID) {
  if (method !== 'POST' || !/^ses_[A-Za-z0-9]+$/.test(sessionID)) return false
  const path = String(url).split('?')[0]
  return path === `/api/session/${sessionID}/prompt` || path === `/api/session/${sessionID}/command`
}

export function isV2MainInterrupt(method, url, sessionID) {
  return method === 'POST' && /^ses_[A-Za-z0-9]+$/.test(sessionID) && String(url).split('?')[0] === `/api/session/${sessionID}/interrupt`
}
