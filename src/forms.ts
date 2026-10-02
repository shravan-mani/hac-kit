import type { HTMLElement } from 'node-html-parser';

const SKIPPED_INPUT_TYPES = new Set(['submit', 'button', 'image', 'reset', 'file']);

/**
 * The fields a browser would submit from `scope`: named inputs, checked boxes, and the selected
 * option of each select. `scope` is usually a form, but can be a whole page when the markup is
 * too broken for the form element to survive parsing. Pass `submitter` to include the button
 * that was clicked.
 */
export function formFields(scope: HTMLElement, submitter?: HTMLElement | null): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const element of scope.querySelectorAll('input, select, textarea')) {
    const name = element.getAttribute('name');
    if (!name) continue;

    switch (element.tagName) {
      case 'SELECT': {
        const option = element.querySelector('option[selected]') ?? element.querySelector('option');
        if (option) fields[name] = option.getAttribute('value') ?? option.text.trim();
        break;
      }
      case 'TEXTAREA':
        fields[name] = element.text;
        break;
      default: {
        const type = (element.getAttribute('type') ?? 'text').toLowerCase();
        if (SKIPPED_INPUT_TYPES.has(type)) break;
        const checkable = type === 'checkbox' || type === 'radio';
        if (checkable && !element.hasAttribute('checked')) break;
        fields[name] = element.getAttribute('value') ?? (checkable ? 'on' : '');
      }
    }
  }

  const submitterName = submitter?.getAttribute('name');
  if (submitter && submitterName) fields[submitterName] = submitter.getAttribute('value') ?? '';
  return fields;
}
