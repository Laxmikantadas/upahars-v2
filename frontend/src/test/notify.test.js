import { describe, expect, it } from 'vitest';
import { notify, subscribe } from '../lib/notify';
const collect = () => { const got = []; const off = subscribe((e) => e.type === 'toast' && got.push(e.toast)); return { got, off }; };
describe('cute notifications', () => {
    it('emits a toast with a friendly title and emoji for each kind', () => {
        const { got, off } = collect();
        notify.cart('Candle is in your cart.');
        notify.error('Something broke.');
        off();
        expect(got.map((t) => t.kind)).toEqual(['cart', 'error']);
        expect(got[1]).toMatchObject({ title: 'Oops!', message: 'Something broke.' });
        expect(got[0].emoji).toBeTruthy();
    });
    it('ignores an identical toast fired twice in a row, and empty messages', () => {
        const { got, off } = collect();
        notify.success('Saved twice?');
        notify.success('Saved twice?');
        notify.info('');
        off();
        expect(got).toHaveLength(1);
    });
    it('never throws when sound is unavailable (server render / old browser)', () => {
        expect(() => notify.celebrate('Order placed!')).not.toThrow();
    });
});
