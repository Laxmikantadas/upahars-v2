import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Shop from './pages/Shop';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import OrderDetail from './pages/OrderDetail';
import Account from './pages/Account';
import BulkOrders from './pages/BulkOrders';
import AdminLogin from './pages/admin/AdminLogin';
import AdminLayout from './pages/admin/AdminLayout';
import Dashboard from './pages/admin/Dashboard';
import AdminOrders from './pages/admin/Orders';
import AdminOrderDetail from './pages/admin/OrderDetail';
import AdminProducts from './pages/admin/Products';
import AdminOffers from './pages/admin/Offers';
import AdminCategories from './pages/admin/Categories';
import AdminShowcase from './pages/admin/Showcase';
import AdminCustomers from './pages/admin/Customers';
import AdminInquiries from './pages/admin/Inquiries';
import AdminDemo from './pages/admin/DemoData';
import AdminShipping from './pages/admin/Shipping';
import Info from './pages/Info';
import TermsAndConditions from './pages/TermsAndConditions';
import ComingSoon from './pages/ComingSoon';
import { RouteSeo } from './components/Seo';
export default function App() {
    return (<>
      <RouteSeo />
      <Routes>
      {/* Separate admin sign-in (no storefront header/footer, no customer sign-up) */}
      <Route path="admin/login" element={<AdminLogin />}/>
      {/* Admin has its own layout with a sidebar (no storefront header/footer) */}
      <Route path="admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />}/>
        <Route path="orders" element={<AdminOrders />}/>
        <Route path="orders/:id" element={<AdminOrderDetail />}/>
        <Route path="products" element={<AdminProducts />}/>
        <Route path="categories" element={<AdminCategories />}/>
        <Route path="carousel" element={<AdminShowcase />}/>
        <Route path="shipping" element={<AdminShipping />}/>
        <Route path="offers" element={<AdminOffers />}/>
        <Route path="customers" element={<AdminCustomers />}/>
        <Route path="inquiries" element={<AdminInquiries />}/>
        <Route path="demo" element={<AdminDemo />}/>
      </Route>
      <Route element={<Layout />}>
        <Route index element={<Home />}/>
        <Route path="categories" element={<Shop />}/>
        <Route path="category/:slug" element={<Shop />}/>
        <Route path="search" element={<Shop />}/>
        <Route path="hampers" element={<Navigate to="/categories?name=Personalized%20Gift%20Hampers" replace/>}/>
        <Route path="product/:slug" element={<ProductDetail />}/>
        <Route path="cart" element={<Cart />}/>
        <Route path="checkout" element={<Checkout />}/>
        <Route path="order/:id" element={<OrderDetail />}/>
        <Route path="account" element={<Account />}/>
        <Route path="bulk-orders" element={<BulkOrders />}/>
        {['about', 'contact', 'faq', 'shipping-policy', 'return-policy', 'privacy-policy'].map((p) => <Route key={p} path={p} element={<Info />}/>)}
        <Route path="terms-and-conditions" element={<TermsAndConditions />}/>
        <Route path="*" element={<ComingSoon />}/>
      </Route>
    </Routes>
    </>);
}
