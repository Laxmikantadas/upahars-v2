import { useLocation } from 'react-router-dom';
import { BRAND } from '../lib/brand';
import ComingSoon from './ComingSoon';
import { useSeo } from '../components/Seo';
import { breadcrumbSchema, faqSchema, parseQas } from '../lib/seo';
const META = {
    '/about': { title: 'About Upahars: Handmade Gifts from Odisha Artisans', description: 'Upahars brings handmade and customized gifts, hampers, candles and home décor from Odisha’s artisans to your doorstep, supporting traditional craft livelihoods.' },
    '/contact': { title: 'Contact Upahars', description: 'Get in touch with Upahars for order help, customized gifts, bulk quotations and delivery questions.' },
    '/faq': { title: 'FAQ: Delivery, Personalization and Bulk Orders', description: 'Answers about delivery time, personalized gifts, bulk orders, payments and returns at Upahars.' },
    '/shipping-policy': { title: 'Shipping Policy: Delivery Time and Charges', description: 'Delivery charges, free shipping above ₹699, dispatch time and delivery across India for Upahars orders.' },
    '/return-policy': { title: 'Return and Refund Policy', description: 'How to report damaged or wrong items, and what can and cannot be returned at Upahars.' },
    '/privacy-policy': { title: 'Privacy Policy', description: 'What details Upahars collects to deliver your order and how they are protected. We never sell your data.' },
};
const PAGES = {
    '/about': { title: 'About Upahars', body: ['Upahars brings handmade and customized gifts, hampers, candles and home décor from Odisha’s artisans to your doorstep.', 'Every piece supports traditional handloom and craft livelihoods. (Draft text — replace with your brand story.)'] },
    '/contact': { title: 'Contact us', body: [`Email: ${BRAND.supportEmail}`, `Phone / WhatsApp: ${BRAND.supportPhone}`, `Address: ${BRAND.address}`, '(Placeholder details — update them in src/lib/brand.js.)'] },
    '/faq': { title: 'FAQ', body: ['How long does delivery take? Usually 4–7 working days; customized gifts take 3–5 extra days.', 'Can I personalize a gift? Yes — enter the name or message on the product page.', 'Do you take bulk orders? Yes — use the Bulk & corporate quotation form.', 'Which payments are accepted? Online only, through Razorpay: UPI, debit/credit cards and wallets. We do not offer cash on delivery or net banking.'] },
    '/shipping-policy': { title: 'Shipping policy', body: ['Delivery is free on orders of ₹699 and above (after discounts); ₹65 otherwise.', 'Orders are dispatched within 2–3 working days; customized items within 5–7.', '(Draft — have your final policy reviewed before launch.)'] },
    '/return-policy': { title: 'Return policy', body: ['Damaged or wrong items can be reported within 48 hours of delivery with photos.', 'Customized and personalized gifts cannot be returned unless damaged or incorrect.', '(Draft — have your final policy reviewed before launch.)'] },
    '/privacy-policy': { title: 'Privacy policy', body: ['We collect only the details needed to deliver your order: name, phone, address and optional email.', 'We never sell your data. Payment details are handled by the payment provider, not stored by us.', '(Draft — have a lawyer review and add your registered business details.)'] },
};
export default function Info() {
    const { pathname } = useLocation();
    const page = PAGES[pathname];
    const m = META[pathname];
    const qas = pathname === '/faq' && page ? parseQas(page.body) : [];
    useSeo(page && m ? { ...m, path: pathname, schema: [breadcrumbSchema([{ name: 'Home', path: '/' }, { name: page.title, path: pathname }]), qas.length ? faqSchema(qas) : null] } : { title: 'Page not found', noindex: true });
    if (!page)
        return <ComingSoon />;
    return (<div className="container-page max-w-2xl py-8">
      <h1 className="text-3xl font-bold">{page.title}</h1>
      <div className="mt-4 space-y-3 text-sm text-neutral-700">{page.body.map((t, i) => <p key={i}>{t}</p>)}</div>
    </div>);
}
