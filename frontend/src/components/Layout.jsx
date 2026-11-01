import { Outlet } from 'react-router-dom';
import Header from './Header';
import LoginGate from './LoginGate';
import Footer from './Footer';
import BottomNav from './BottomNav';
import ScrollToTop from './ScrollToTop';
export default function Layout() {
    return (<div className="flex min-h-screen flex-col pb-safe-nav md:pb-0">
      <ScrollToTop />
      <Header />
      <main className="flex-1">
        <LoginGate><Outlet /></LoginGate>
      </main>
      <Footer />
      <BottomNav />
    </div>);
}
