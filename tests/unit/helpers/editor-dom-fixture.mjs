export function editorNode(tagName = 'div') {
  const attributes = new Map(), classes = new Set(), handlers = new Map();
  const node = {
    tagName, dataset: {}, children: [], style: { setProperty() {}, removeProperty() {} }, value: '', hidden: false,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); } },
    addEventListener(type, handler) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(handler); },
    removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
    dispatch(type, input = {}) { const event = { target: node, currentTarget: node, preventDefault() {}, stopPropagation() {}, ...input }; for (const handler of handlers.get(type) || []) handler(event); },
    setAttribute: (key, value) => attributes.set(key, String(value)), getAttribute: key => attributes.get(key) || null,
    removeAttribute: key => attributes.delete(key), setCustomValidity() {}, reportValidity() {},
    replaceChildren(...children) { node.children = children; }, append(...children) { node.children.push(...children); }, appendChild(child) { node.children.push(child); },
    contains: child => node.children.includes(child), querySelector: () => null, querySelectorAll: () => [],
    matches: selector => selector === ':popover-open' && node.open,
    showPopover() { node.open = true; }, hidePopover() { node.open = false; },
    focus() { node.focused = true; }, click() { node.dispatch('click'); },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 120, bottom: 32, width: 120, height: 32 }),
  };
  return node;
}
