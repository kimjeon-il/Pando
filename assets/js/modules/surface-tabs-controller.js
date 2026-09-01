const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function createSurfaceTabsController({ tablist, onSelect }) {
  const allTabs = () => [...(tablist?.querySelectorAll?.('[role="tab"][data-surface-tab]') || [])];
  const availableTabs = () => allTabs().filter(tab => !tab.hidden && !tab.disabled && tab.getAttribute('aria-disabled') !== 'true');

  function sync(activeKey, { focus = false } = {}) {
    const key = String(activeKey || '');
    let activeTab = null;
    for (const tab of allTabs()) {
      const active = tab.dataset.surfaceTab === key && !tab.hidden && tab.getAttribute('aria-disabled') !== 'true';
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active) activeTab = tab;
    }
    if (!activeTab) {
      activeTab = availableTabs()[0] || null;
      if (activeTab) {
        activeTab.classList.add('active');
        activeTab.setAttribute('aria-selected', 'true');
        activeTab.tabIndex = 0;
      }
    }
    const panelId = activeTab?.getAttribute('aria-controls');
    const panel = panelId ? activeTab.ownerDocument?.getElementById?.(panelId) : null;
    if (panel) panel.setAttribute('aria-labelledby', activeTab.id);
    if (focus) activeTab?.focus({ preventScroll: true });
    return activeTab?.dataset.surfaceTab || '';
  }

  function select(tab, { focus = false } = {}) {
    if (!tab || tab.hidden || tab.disabled || tab.getAttribute('aria-disabled') === 'true') return false;
    onSelect?.(tab.dataset.surfaceTab, { focus });
    return true;
  }

  function bind() {
    if (!tablist) return;
    tablist.addEventListener('click', event => {
      const tab = event.target.closest?.('[role="tab"][data-surface-tab]');
      if (tab?.closest('[role="tablist"]') === tablist) select(tab);
    });
    tablist.addEventListener('keydown', event => {
      if (!NAVIGATION_KEYS.has(event.key)) return;
      const tabs = availableTabs();
      const index = tabs.indexOf(event.target.closest?.('[role="tab"]'));
      if (index < 0 || !tabs.length) return;
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      select(tabs[nextIndex], { focus: true });
    });
  }

  return Object.freeze({ bind, sync });
}
