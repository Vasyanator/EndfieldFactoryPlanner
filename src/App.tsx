import { useState } from 'react'

import { SectionTabs } from './components/SectionTabs'
import { useGameData } from './data/useGameData'
import type { TopTab } from './data/types'
import { ConstructionTab } from './tabs/ConstructionTab'
import { ItemsTab } from './tabs/ItemsTab'
import { PlanningTab } from './tabs/PlanningTab'

const topTabs = [
  { id: 'items', label: 'Предметы' },
  { id: 'planning', label: 'Планирование' },
  { id: 'construction', label: 'Постройка' },
] as const

export default function App() {
  const [topTab, setTopTab] = useState<TopTab>('items')
  const data = useGameData()

  const appClassName = topTab === 'items' ? 'app' : 'app app--wide'

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <h1 className="app__title">Endfield Factory Planner</h1>
          <SectionTabs value={topTab} onChange={(v) => setTopTab(v as TopTab)} tabs={topTabs} />
        </div>
      </header>

      <main className={appClassName}>
        {data.loading && <p className="app__status">Загрузка данных…</p>}
        {data.error && <p className="app__status app__status--error">Ошибка: {data.error}</p>}

        {!data.loading && !data.error && (
          <>
            <section className={topTab === 'items' ? 'tab-panel tab-panel--active' : 'tab-panel'}>
              <ItemsTab
                items={data.items}
                buildings={data.buildings}
                itemLookup={data.itemLookup}
                buildingLookup={data.buildingLookup}
              />
            </section>

            <section className={topTab === 'planning' ? 'tab-panel tab-panel--active' : 'tab-panel'}>
              <PlanningTab
                items={data.items}
                buildings={data.buildings}
                itemLookup={data.itemLookup}
                buildingLookup={data.buildingLookup}
                buildingItems={data.buildingItems}
                planningBuildings={data.planningBuildings}
                isActive={topTab === 'planning'}
              />
            </section>

            <section className={topTab === 'construction' ? 'tab-panel tab-panel--active' : 'tab-panel'}>
              <ConstructionTab />
            </section>
          </>
        )}
      </main>
    </div>
  )
}
