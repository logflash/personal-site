import { describe, expect, it } from 'vitest';

import { withCspStyleNonces } from '../csp';

describe('replay CSP styles', () => {
  it('nonces serialized style elements without mutating the recording', () => {
    const style = {
      type: 2,
      id: 4,
      tagName: 'style',
      attributes: { id: 'theme', nonce: 'old' },
      childNodes: [{ type: 3, id: 5, textContent: 'body{color:red}' }],
    };
    const events = [
      {
        type: 2,
        timestamp: 1,
        data: {
          node: { type: 0, id: 1, childNodes: [style] },
          initialOffset: { left: 0, top: 0 },
        },
      },
    ];

    const prepared = withCspStyleNonces(events, 'current');
    const preparedStyle = prepared[0].data.node.childNodes[0];
    expect(preparedStyle.attributes.nonce).toBe('current');
    expect(style.attributes.nonce).toBe('old');
  });

  it('nonces stylesheet links that rrweb reconstructs as style elements', () => {
    const events = [
      {
        type: 3,
        timestamp: 2,
        data: {
          source: 0,
          texts: [],
          attributes: [],
          removes: [],
          adds: [
            {
              parentId: 1,
              nextId: null,
              node: {
                type: 2,
                id: 2,
                tagName: 'link',
                attributes: { rel: 'stylesheet', _cssText: '.card{display:block}' },
                childNodes: [],
              },
            },
          ],
        },
      },
    ];

    const prepared = withCspStyleNonces(events, 'current');
    expect(prepared[0].data.adds[0].node.attributes.nonce).toBe('current');
    expect(events[0].data.adds[0].node.attributes.nonce).toBeUndefined();
  });
});
