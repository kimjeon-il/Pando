/** Project replacement coordinator. Candidates are detached until accepted. */
export function createViewerSession({ createSession, prepare = async () => {}, restore = async () => {}, onAccepted = () => {} }) {
  let current = null, request = 0, disposed = false;
  let presentation = Promise.resolve();
  async function open(read) {
    const ticket = ++request;
    let candidate;
    try {
      const project = await read();
      if (disposed || ticket !== request) return false;
      candidate = createSession(project);
      await candidate.commandOwner.load(JSON.stringify(project));
      if (disposed || ticket !== request) { candidate.commandOwner.dispose(); return false; }
      const accept = presentation.then(async () => {
        if (disposed || ticket !== request) return false;
        const previous = current;
        try {
          await prepare(candidate);
          if (disposed || ticket !== request) {
            if (!disposed) await restore(previous);
            return false;
          }
          onAccepted(candidate);
          current = candidate;
          previous?.commandOwner.dispose();
          return true;
        } catch (error) {
          if (!disposed) await restore(previous);
          throw error;
        }
      });
      presentation = accept.catch(() => {});
      const accepted = await accept;
      if (!accepted) candidate.commandOwner.dispose();
      return accepted;
    } catch (error) {
      if (candidate !== current) candidate?.commandOwner.dispose();
      if (disposed || ticket !== request) return false;
      throw error;
    }
  }
  return Object.freeze({ open, current: () => current,
    dispose() { disposed = true; request++; current?.commandOwner.dispose(); current = null; } });
}
