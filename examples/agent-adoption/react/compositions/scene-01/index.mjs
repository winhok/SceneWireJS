import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

let view;
const clamp = (n) => Math.max(0, Math.min(1, n));
const stages = [
  ['FrameContext', 'One frame is the source of time.', 'frame / fps'],
  [
    'React composition',
    'Render the same state at any seek.',
    'view.render(state)',
  ],
  [
    'Encoded video',
    'Check the pixels. Deliver the MP4.',
    'render → final-media-qc',
  ],
];
export default {
  mount(root) {
    view = createRoot(root);
  },
  seek(context) {
    const frame = context.frame;
    const active = Math.min(2, Math.floor(frame / 100));
    const local = clamp((frame % 100) / 20);
    const eased = 1 - Math.pow(1 - local, 3);
    const progress = frame / 299;
    flushSync(() =>
      view.render(
        h(
          'div',
          {
            style: {
              position: 'absolute',
              inset: 0,
              background: '#f1f0e9',
              color: '#192321',
              fontFamily: 'Arial, sans-serif',
              padding: '68px 76px',
            },
          },
          h(
            'div',
            { style: { fontSize: 20, color: '#4e5c56' } },
            'SceneWire / React technical explainer',
          ),
          h(
            'h1',
            {
              style: {
                fontSize: 66,
                letterSpacing: -2,
                fontWeight: 600,
                margin: '22px 0 44px',
              },
            },
            'Time is data.',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 24 } },
            stages.map(([title, description, code], index) =>
              h(
                'div',
                {
                  key: title,
                  style: {
                    width: 360,
                    minHeight: 256,
                    borderTop: `4px solid ${index === active ? '#db512b' : '#bac0b6'}`,
                    paddingTop: 22,
                    opacity: index > active ? 0.42 : 1,
                  },
                },
                h(
                  'div',
                  {
                    style: { fontSize: 18, marginBottom: 24, color: '#4e5c56' },
                  },
                  `0${index + 1}`,
                ),
                h(
                  'h2',
                  {
                    style: {
                      fontSize: 30,
                      margin: '0 0 18px',
                      fontWeight: 600,
                    },
                  },
                  title,
                ),
                h(
                  'p',
                  {
                    style: {
                      fontSize: 24,
                      lineHeight: 1.4,
                      margin: '0 0 24px',
                    },
                  },
                  description,
                ),
                h('code', { style: { fontSize: 18 } }, code),
              ),
            ),
          ),
          h(
            'div',
            {
              style: {
                marginTop: 34,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              },
            },
            h(
              'span',
              {
                style: {
                  fontSize: 24,
                  transform: `translateY(${(1 - eased) * 12}px)`,
                  opacity: 0.45 + eased * 0.55,
                },
              },
              stages[active][1],
            ),
            h(
              'code',
              { style: { fontSize: 18 } },
              `frame ${String(frame).padStart(3, '0')} / 299`,
            ),
          ),
          h(
            'div',
            {
              style: {
                position: 'absolute',
                left: 76,
                right: 76,
                bottom: 68,
                height: 5,
                background: '#bac0b6',
              },
            },
            h('div', {
              style: {
                height: '100%',
                width: `${progress * 100}%`,
                background: '#db512b',
              },
            }),
          ),
        ),
      ),
    );
  },
  dispose() {
    view.unmount();
  },
};
