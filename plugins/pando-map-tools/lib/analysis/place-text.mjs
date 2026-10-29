// Canonical source-preserving search normalization and OCR name similarity.
function foldSpecialLatin(value) {
  return value
    .replace(/\u00df/g, 'ss')
    .replace(/\u00e6/g, 'ae')
    .replace(/\u0153/g, 'oe')
    .replace(/\u00f8/g, 'o')
    .replace(/\u0142/g, 'l')
    .replace(/\u0111/g, 'd')
    .replace(/\u00f0/g, 'd')
    .replace(/\u00fe/g, 'th');
}

export function normalizeReferenceImagePlaceText(value) {
  let text = String(value ?? '').normalize('NFKD').toLocaleLowerCase();
  text = text.replace(/[\u0300-\u036f]/g, '');
  text = text.replace(/[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/\u06cc/g, '\u064a').replace(/\u06a9/g, '\u0643').replace(/\u03c2/g, '\u03c3')
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) % 16));
  text = foldSpecialLatin(text);
  text = text
    .replace(/[\s.,;:!?()[\]{}'"\u201c\u201d\u2018\u2019/\\|_+=*~<>\u2014\u2013-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return text;
}

function compactText(value) {
  return normalizeReferenceImagePlaceText(value).replace(/\s+/g, '');
}

function damerauLevenshtein(a, b, maximum = Number.POSITIVE_INFINITY) {
  const left = [...a];
  const right = [...b];
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previousPrevious = null;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      let value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      if (
        previousPrevious
        && i > 1
        && j > 1
        && left[i - 1] === right[j - 2]
        && left[i - 2] === right[j - 1]
      ) {
        value = Math.min(value, previousPrevious[j - 2] + 1);
      }
      current[j] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length];
}

export function referenceImagePlaceNameSimilarity(leftValue, rightValue) {
  const left = normalizeReferenceImagePlaceText(leftValue);
  const right = normalizeReferenceImagePlaceText(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftCompact = compactText(left);
  const rightCompact = compactText(right);
  if (leftCompact === rightCompact) return 0.995;

  const maximumLength = Math.max([...leftCompact].length, [...rightCompact].length);
  const minimumLength = Math.min([...leftCompact].length, [...rightCompact].length);
  if (maximumLength <= 3) return 0;

  let prefixScore = 0;
  if (
    minimumLength >= 4
    && (leftCompact.startsWith(rightCompact) || rightCompact.startsWith(leftCompact))
  ) {
    prefixScore = 0.86 + 0.12 * (minimumLength / maximumLength);
  }

  const maximumEdits = Math.max(1, Math.floor(maximumLength * 0.34));
  const distance = damerauLevenshtein(leftCompact, rightCompact, maximumEdits);
  const editScore = distance > maximumEdits ? 0 : 1 - distance / maximumLength;

  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  let tokenScore = 0;
  if (leftTokens.size > 1 || rightTokens.size > 1) {
    let intersection = 0;
    for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
    tokenScore = intersection / Math.max(leftTokens.size, rightTokens.size);
  }

  return Math.max(0, Math.min(1, Math.max(editScore, prefixScore, tokenScore * 0.92)));
}

