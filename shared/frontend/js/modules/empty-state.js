export function createEmptyState(document, title, description, { tag = 'div', compact = false } = {}) {
    const empty = document.createElement(tag);
    empty.className = `ui-empty-state${compact ? ' ui-empty-state--compact' : ''}`;
    const heading = document.createElement('strong');
    const text = document.createElement('p');
    heading.textContent = title;
    text.textContent = description;
    empty.append(heading, text);
    return empty;
  }
