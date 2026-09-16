import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { DemoModeProvider } from '../../context/DemoModeContext';
import { DemoModeBanner } from './DemoModeBanner';

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <DemoModeProvider>
      <div className="min-h-screen">
        <Sidebar
          mobileOpen={mobileOpen}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <DemoModeBanner />
        <div
          className={`flex min-h-screen min-w-0 flex-col transition-[padding] duration-200 ease-out ${
            collapsed ? 'lg:pl-[76px]' : 'lg:pl-[264px]'
          }`}
        >
          <Header onOpenMobileNav={() => setMobileOpen(true)} />
          <main
            id="main-content"
            role="main"
            className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8"
          >
            <Outlet />
          </main>
        </div>
      </div>
    </DemoModeProvider>
  );
}