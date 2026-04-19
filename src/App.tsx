/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ComicEditor from './components/ComicEditor';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function App() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
        <main className="py-12">
          <ComicEditor />
        </main>
        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}

