/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ComicEditor from './components/ComicEditor';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from 'next-themes';

export default function App() {
  return (
    // @ts-ignore
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
          <ComicEditor />
          <Toaster position="bottom-right" />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}

