type TabSpec = { id: string; label: string }

type SectionTabsProps = {
  value: string
  onChange: (value: string) => void
  tabs: ReadonlyArray<TabSpec>
}

export function SectionTabs(props: SectionTabsProps) {
  const { value, onChange, tabs } = props
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          className={value === tab.id ? 'tab tab--active' : 'tab'}
          onClick={() => onChange(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
