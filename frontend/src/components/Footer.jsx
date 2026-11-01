import { Link } from 'react-router-dom';
import DoodleCrewFooter from '@/components/ui/doodle-crew-footer';
import { BRAND } from '../lib/brand';
// Site map for the footer. Every `to` is a real route in App.jsx.
const COLUMNS = [
    { title: 'Shop', links: [{ label: 'All categories', to: '/categories' }, { label: 'Gift hampers', to: '/hampers' }, { label: 'Bulk & corporate', to: '/bulk-orders' }, { label: 'Your cart', to: '/cart' }] },
    { title: 'Help', links: [{ label: 'FAQ', to: '/faq' }, { label: 'Shipping policy', to: '/shipping-policy' }, { label: 'Return policy', to: '/return-policy' }, { label: 'Contact', to: '/contact' }] },
    { title: 'Upahars', links: [{ label: 'About us', to: '/about' }, { label: 'Privacy policy', to: '/privacy-policy' }, { label: 'Terms and conditions', to: '/terms-and-conditions' }, { label: 'My account', to: '/account' }] },
];
const ACTIONS = [
    { label: 'Shop gifts', to: '/categories', icon: 'heart', variant: 'solid' },
    { label: 'Bulk orders', to: '/bulk-orders', icon: 'star', variant: 'outline' },
];
// UPAHARS = U(0) P(1) A(2) H(3) A(4) R(5) S(6)
const CREW = [
    { kind: 'cat', letter: 2, seat: 'front', offset: 0, name: 'Patch', says: 'Handmade, just for you!' },
    { kind: 'bird', letter: 1, seat: 'top', offset: 0, name: 'Pip', says: 'Tweet! Your gift has arrived.' },
    { kind: 'ghost', letter: 3, seat: 'behind', name: 'Boo', says: 'Is that a gift hamper?' },
    { kind: 'kid', letter: 5, seat: 'top', name: 'Juno', says: 'Best seat in the house!' },
    { kind: 'yeti', letter: 4, seat: 'front', offset: 0, scale: 0.8, flip: true, name: 'Bruno', says: 'Wrap one for me too.' },
];
// Diyas (flames), hearts and stars suit a gifting shop.
const DOODLES = ['flame', 'heart', 'star', 'flame', 'sparkle', 'heart'];
export default function Footer() {
    return (<div className="mt-12 border-t border-gold/40">
      <DoodleCrewFooter wordmark={BRAND.name} brand={BRAND.name} logo={<img src={BRAND.icon} alt="" width={32} height={32}/>} blurb="Handmade, customised gifts, hampers and candles — made in Odisha and delivered across India." tagline={BRAND.tagline} columns={COLUMNS} actions={ACTIONS} crew={CREW} doodles={DOODLES} doodleCount={9} linkAs={Link} palette={{ background: '#F7EDD6', ink: '#7A1118', accent: '#C58F3C' }} serifFamily='"Cormorant Garamond", Georgia, serif' copyright={`© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.`} legal={[{ label: 'Privacy', to: '/privacy-policy' }, { label: 'Terms', to: '/terms-and-conditions' }]} socials={[]} height="600px"/>
    </div>);
}
