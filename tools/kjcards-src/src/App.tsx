import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { BoardCanvas } from './components/BoardCanvas';
import { ParkTray } from './components/ParkTray';
import { Modals } from './components/Modals';

export function App() {
  return (
    <div className="kj-app">
      <TopBar />
      <div className="kj-main">
        <ReactFlowProvider>
          <div className="kj-center">
            <BoardCanvas />
            <ParkTray />
          </div>
        </ReactFlowProvider>
        <Sidebar />
      </div>
      <Modals />
    </div>
  );
}
