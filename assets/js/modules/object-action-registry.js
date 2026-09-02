const freezeAction = action => Object.freeze({
  ...action,
  domains: Object.freeze([...(action.domains || [])]),
  types: Object.freeze([...(action.types || [])]),
});

const text = value => String(value ?? '').trim();

export const OBJECT_ACTIONS = Object.freeze({
  focus: freezeAction({
    id: 'focus',
    command: 'object.focus',
    label: '지도에서 보기',
    help: '선택한 객체가 보이도록 지도를 이동합니다.',
    icon: 'icon-focus-object',
    capability: 'focus',
    danger: false,
  }),
  lock: freezeAction({
    id: 'lock',
    command: 'object.lock.toggle',
    label: context => context?.locked ? '잠금 해제' : '잠금',
    help: context => context?.locked ? '선택한 객체의 잠금을 해제합니다.' : '선택한 객체를 잠급니다.',
    icon: context => context?.locked ? 'icon-lock-closed' : 'icon-lock-open',
    capability: 'lock',
    danger: false,
  }),
  delete: freezeAction({
    id: 'delete',
    command: 'object.delete',
    label: '삭제',
    help: '선택한 객체를 삭제합니다.',
    icon: 'icon-trash',
    capability: 'delete',
    danger: true,
  }),
  'change-type': freezeAction({
    id: 'change-type',
    command: 'territorial.change-type',
    label: '종류 변경',
    help: '선택한 영토·구역 객체의 종류를 변경합니다.',
    icon: 'icon-chevron-right',
    capability: 'change-type',
    domains: ['territorial'],
    types: ['country', 'territory', 'admin', 'region'],
    danger: false,
  }),
  'border-edit': freezeAction({
    id: 'border-edit',
    command: 'territorial.edit-border',
    label: '국경 조정',
    help: '선택한 국가 사이의 공유 국경을 편집합니다.',
    icon: 'icon-chevron-right',
    capability: 'edit-border',
    domains: ['territorial'],
    types: ['country'],
    danger: false,
  }),
  'coast-edit': freezeAction({
    id: 'coast-edit',
    command: 'territorial.edit-coast',
    label: '해안선 조정',
    help: '선택한 객체의 외곽 해안선을 편집합니다.',
    icon: 'icon-chevron-right',
    capability: 'edit-coast',
    domains: ['territorial'],
    danger: false,
  }),
  'coast-reconcile': freezeAction({
    id: 'coast-reconcile',
    command: 'territorial.reconcile-coast',
    label: '해안선 정합',
    help: '국가 해안선과 불일치하는 경계를 정합합니다.',
    icon: 'icon-coastline',
    capability: 'reconcile-coast',
    domains: ['territorial', 'generic'],
    danger: false,
  }),
  merge: freezeAction({
    id: 'merge',
    command: 'object.merge',
    label: '영역 합치기',
    help: '호환되는 인접 객체를 하나로 합칩니다.',
    icon: 'icon-chevron-right',
    capability: 'merge',
    danger: false,
  }),
  split: freezeAction({
    id: 'split',
    command: 'object.split',
    label: '영역 나누기',
    help: '선택한 객체를 새 경계로 나눕니다.',
    icon: 'icon-chevron-right',
    capability: 'split',
    danger: false,
  }),
});

function resolveValue(value, context) {
  return typeof value === 'function' ? value(context || {}) : value;
}

function capabilitySet(context) {
  const source = context?.capabilities;
  if (source instanceof Set) return source;
  if (Array.isArray(source)) return new Set(source.map(text));
  return null;
}

export function objectActionApplies(actionOrId, context = {}) {
  const action = typeof actionOrId === 'string' ? OBJECT_ACTIONS[actionOrId] : actionOrId;
  if (!action) return false;
  const domain = text(context.domain);
  const type = text(context.type);
  if (action.domains.length && domain && !action.domains.includes(domain)) return false;
  if (action.types.length && type && !action.types.includes(type)) return false;
  const capabilities = capabilitySet(context);
  if (capabilities && action.capability && !capabilities.has(action.capability)) return false;
  if (context.disabled === true) return false;
  return true;
}

export function resolveObjectAction(id, context = {}) {
  const action = OBJECT_ACTIONS[id];
  if (!action) return null;
  return Object.freeze({
    id: action.id,
    command: action.command,
    label: text(resolveValue(action.label, context)),
    help: text(resolveValue(action.help, context)),
    icon: text(resolveValue(action.icon, context)),
    capability: action.capability,
    danger: action.danger === true,
    applies: objectActionApplies(action, context),
  });
}

export function objectActionsFor(context = {}, ids = Object.keys(OBJECT_ACTIONS)) {
  return ids.map(id => resolveObjectAction(id, context)).filter(action => action?.applies);
}

/**
 * Command bridge used by the next application-architecture phase. The registry
 * owns action identity/presentation/applicability; mutation semantics remain in
 * the injected command executor.
 */
export function createObjectActionExecutor({ execute }) {
  if (typeof execute !== 'function') throw new TypeError('object action executor requires execute(command, context, payload)');
  return Object.freeze({
    execute(id, context = {}, payload = undefined) {
      const action = resolveObjectAction(id, context);
      if (!action?.applies) return false;
      return execute(action.command, context, payload);
    },
  });
}
