interface AssistantReply {
  id: string
  error?: string
  status?: number
  text?: string
}

export function hasFenbiAssistant() {
  return document.documentElement.dataset.fenbiAssistant === '1'
}

export function requestFenbiAssistant(payload: Record<string, unknown>): Promise<AssistantReply> {
  return new Promise((resolve, reject) => {
    if (!hasFenbiAssistant()) {
      reject(new Error('请安装或更新粉笔助手，并刷新答题卡页面。'))
      return
    }
    const id = crypto.randomUUID()
    const finish = () => {
      clearTimeout(timeout)
      document.removeEventListener('shenlun:assistant-response', receive)
    }
    const receive = (event: Event) => {
      let reply: AssistantReply
      try {
        reply = JSON.parse((event as CustomEvent<string>).detail)
      } catch {
        return
      }
      if (reply?.id !== id) return
      finish()
      if (reply.error) reject(new Error(reply.error))
      else resolve(reply)
    }
    const timeout = window.setTimeout(() => {
      finish()
      reject(new Error('粉笔助手没有响应，请刷新页面后重试。'))
    }, 17000)
    document.addEventListener('shenlun:assistant-response', receive)
    document.dispatchEvent(new CustomEvent('shenlun:assistant-request', {
      detail: JSON.stringify({ ...payload, id }),
    }))
  })
}
