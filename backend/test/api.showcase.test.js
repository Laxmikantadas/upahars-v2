import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLOUD, client, login, loginAdmin, resetDb, startApp, stopDb } from './helpers.js';
import { Showcase } from '../src/models/index.js';

let ctx, admin;
beforeAll(async () => { ctx = await startApp(); });
afterAll(stopDb);
beforeEach(async () => { await resetDb(); admin = await loginAdmin(ctx.app); });

const photo = (name) => `https://res.cloudinary.com/${CLOUD}/image/upload/v1/upahars/site/${name}.jpg`;

describe('home-page polaroid carousel (showcase)', () => {
  it('admin adds, edits, hides and deletes pictures; the storefront only shows active ones in order', async () => {
    const a = await admin.post('/api/admin/showcase').send({ title: 'Hand-painted Diyas', caption: 'Painted one at a time.', sortOrder: 1, image: { url: photo('diya') } });
    expect(a.status).toBe(201);
    expect(a.body.item.image.publicId).toBe('upahars/site/diya');
    const b = await admin.post('/api/admin/showcase').send({ title: 'Festive Hampers', sortOrder: 0 });
    expect(b.status).toBe(201);

    let pub = (await client(ctx.app).get('/api/showcase')).body.showcase;
    expect(pub.map((s) => s.title)).toEqual(['Festive Hampers', 'Hand-painted Diyas']); // sorted by position
    expect(pub[1]).toMatchObject({ caption: 'Painted one at a time.', image: photo('diya') });
    expect(pub[0].image).toBeNull();

    const u = await admin.patch(`/api/admin/showcase/${a.body.item._id}`).send({ title: 'Diyas', isActive: false });
    expect(u.status).toBe(200);
    pub = (await client(ctx.app).get('/api/showcase')).body.showcase;
    expect(pub.map((s) => s.title)).toEqual(['Festive Hampers']); // hidden one is not public
    expect((await admin.get('/api/admin/showcase')).body.items).toHaveLength(2); // but the admin still sees it

    expect((await admin.patch(`/api/admin/showcase/${b.body.item._id}`).send({ image: { url: photo('hamper') } })).body.item.image.url).toBe(photo('hamper'));
    expect((await admin.patch(`/api/admin/showcase/${b.body.item._id}`).send({ image: null })).body.item.image).toBeNull();

    expect((await admin.delete(`/api/admin/showcase/${a.body.item._id}`)).status).toBe(200);
    expect(await Showcase.countDocuments()).toBe(1);
    expect((await admin.delete(`/api/admin/showcase/${a.body.item._id}`)).status).toBe(404);
  });

  it('validates input and only accepts images uploaded through Upahars', async () => {
    expect((await admin.post('/api/admin/showcase').send({ title: 'x' })).status).toBe(400);
    expect((await admin.post('/api/admin/showcase').send({ title: 'Diyas', caption: 'y'.repeat(161) })).status).toBe(400);
    expect((await admin.post('/api/admin/showcase').send({ title: 'Diyas', surprise: 1 })).status).toBe(400);
    const external = await admin.post('/api/admin/showcase').send({ title: 'Diyas', image: { url: 'https://evil.example/pic.jpg' } });
    expect(external.status).toBe(400); expect(external.body.error.code).toBe('bad_image');
    expect(await Showcase.countDocuments()).toBe(0);
  });

  it('is admin-only for changes, public for reading', async () => {
    expect((await client(ctx.app).post('/api/admin/showcase').send({ title: 'Diyas' })).status).toBe(401);
    const customer = await login(ctx.app);
    expect((await customer.post('/api/admin/showcase').send({ title: 'Diyas' })).status).toBe(403);
    expect((await client(ctx.app).get('/api/showcase')).status).toBe(200);
  });

  it('keeps at most 24 pictures', async () => {
    await Showcase.insertMany(Array.from({ length: 24 }, (_, i) => ({ title: `Pic ${i}`, sortOrder: i })));
    const r = await admin.post('/api/admin/showcase').send({ title: 'One too many' });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('limit');
  });
});
