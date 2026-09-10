// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  isVerticalScrollContainer,
  REORDER_AUTO_SCROLL,
  shouldHandleDndEvent,
} from '../dndSensors';

describe('shouldHandleDndEvent', () => {
  it('allows a drag to start from a plain element', () => {
    const el = document.createElement('span');
    expect(shouldHandleDndEvent(el)).toBe(true);
  });

  it('allows a drag to start from an element marked data-no-dnd=false or unmarked ancestors', () => {
    const outer = document.createElement('div');
    const inner = document.createElement('span');
    outer.appendChild(inner);
    expect(shouldHandleDndEvent(inner)).toBe(true);
  });

  it('refuses a drag from an element itself marked data-no-dnd', () => {
    const el = document.createElement('button');
    el.setAttribute('data-no-dnd', '');
    expect(shouldHandleDndEvent(el)).toBe(false);
  });

  it('refuses a drag from a descendant of a data-no-dnd ancestor', () => {
    const zone = document.createElement('div');
    zone.setAttribute('data-no-dnd', '');
    const icon = document.createElement('svg');
    zone.appendChild(icon);
    expect(shouldHandleDndEvent(icon)).toBe(false);
  });

  it('stops excluding once outside the data-no-dnd subtree', () => {
    const row = document.createElement('div');
    const excludedZone = document.createElement('div');
    excludedZone.setAttribute('data-no-dnd', '');
    const title = document.createElement('a');
    row.appendChild(excludedZone);
    row.appendChild(title);
    expect(shouldHandleDndEvent(title)).toBe(true);
  });

  it('allows a drag when the target is not an Element (e.g. null or a text node)', () => {
    expect(shouldHandleDndEvent(null)).toBe(true);
    const text = document.createTextNode('hello');
    expect(shouldHandleDndEvent(text as unknown as EventTarget)).toBe(true);
  });
});

describe('isVerticalScrollContainer', () => {
  function el(overflowY: string, overflowX = 'visible') {
    const div = document.createElement('div');
    div.style.overflowY = overflowY;
    div.style.overflowX = overflowX;
    document.body.appendChild(div);
    return div;
  }

  it('allows a vertical scroll container (overflow-y: auto / scroll)', () => {
    expect(isVerticalScrollContainer(el('auto'))).toBe(true);
    expect(isVerticalScrollContainer(el('scroll'))).toBe(true);
  });

  it('refuses a horizontal-only scroller such as the mobile carousel (overflow-x: auto, overflow-y: hidden)', () => {
    expect(isVerticalScrollContainer(el('hidden', 'auto'))).toBe(false);
  });

  it('refuses an element that does not scroll vertically at all', () => {
    expect(isVerticalScrollContainer(el('visible'))).toBe(false);
    expect(isVerticalScrollContainer(el('clip'))).toBe(false);
  });

  it('always allows the document scrolling element', () => {
    // jsdom doesn't implement document.scrollingElement (undefined), so pin
    // it to <html> the way every standards-mode browser resolves it.
    Object.defineProperty(document, 'scrollingElement', {
      value: document.documentElement,
      configurable: true,
    });
    try {
      // <html> has overflow-y: visible — only the scrollingElement identity
      // check can admit it, which is exactly what this asserts.
      expect(isVerticalScrollContainer(document.documentElement)).toBe(true);
    } finally {
      Object.defineProperty(document, 'scrollingElement', { value: undefined, configurable: true });
    }
  });

  it('is what REORDER_AUTO_SCROLL hands dnd-kit as canScroll', () => {
    expect(REORDER_AUTO_SCROLL.canScroll).toBe(isVerticalScrollContainer);
  });
});
