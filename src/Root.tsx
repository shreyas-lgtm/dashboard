import { useState } from 'react';
import { Factory, LayoutDashboard } from 'lucide-react';
import App from './App';
import CalculatorApp from './calculator/CalculatorApp';

type View = 'procurement' | 'calculator';

export default function Root() {
  const [view, setView] = useState<View>('calculator');

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center gap-1">
          <TabButton
            active={view === 'calculator'}
            onClick={() => setView('calculator')}
            icon={<Factory size={15} />}
            label="Manufacturing Calculator"
          />
          <TabButton
            active={view === 'procurement'}
            onClick={() => setView('procurement')}
            icon={<LayoutDashboard size={15} />}
            label="Procurement Pipeline"
          />
        </div>
      </nav>

      {view === 'procurement' ? (
        <App />
      ) : (
        <>
          <header className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="max-w-7xl mx-auto">
              <h1 className="text-xl font-semibold text-gray-900">
                Manufacturing Cost Calculator
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Budgetary part pricing from the SPMIL Annexure A rate card · upload a
                drawing or CAD model, or enter parameters by hand
              </p>
            </div>
          </header>
          <CalculatorApp />
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
