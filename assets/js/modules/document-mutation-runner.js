export function createDocumentMutationRunner({ commandPipeline = null, runDocumentMutation = null } = {}) {
  if (commandPipeline?.runMutation) {
    return (meta, mutate, options = {}) => {
      const result = commandPipeline.runMutation(meta, mutate, options);
      if (!result?.ok) throw result?.error || new Error('Document mutation failed.');
      return result.value;
    };
  }
  if (typeof runDocumentMutation === 'function') return runDocumentMutation;
  throw new TypeError('A commandPipeline or runDocumentMutation compatibility callback is required.');
}
