'use client';
import React from 'react';
import { Cog, Database, Sliders, Zap } from 'lucide-react';
import Modal from './ui/Modal';
import { Tabs, TabsList, TabsTab, TabsPanel } from './ui/Tabs';
import ProvidersTab from './settings/ProvidersTab';
import SearchTab from './settings/SearchTab';
import AdvancedTab from './settings/AdvancedTab';
import { version } from '../package.json';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onProvidersChanged?: () => void;
  onSettingsChanged?: () => void;
  modelGroups: any[] | null;
  modelOptions: any[];
}

export default function SettingsModal({
  open,
  onClose,
  onProvidersChanged,
  onSettingsChanged,
  modelGroups,
  modelOptions,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = React.useState('providers');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <Cog aria-hidden="true" className="size-4" /> Settings
        </span>
      }
    >
      <div className="flex min-h-100 flex-col gap-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <TabsList ariaLabel="Settings tabs">
            <TabsTab value="providers">
              <Database aria-hidden="true" />
              Providers
            </TabsTab>
            <TabsTab value="search">
              <Zap aria-hidden="true" />
              Search Engines
            </TabsTab>
            <TabsTab value="advanced">
              <Sliders aria-hidden="true" />
              Advanced
            </TabsTab>
          </TabsList>

          {/* Panels stay mounted so each tab keeps its form state while hidden. */}
          <TabsPanel value="providers" keepMounted>
            <ProvidersTab
              isVisible={activeTab === 'providers'}
              isOpen={open}
              onProvidersChanged={onProvidersChanged}
            />
          </TabsPanel>
          <TabsPanel value="search" keepMounted>
            <SearchTab isVisible={activeTab === 'search'} isOpen={open} />
          </TabsPanel>
          <TabsPanel value="advanced" keepMounted>
            <AdvancedTab
              isVisible={activeTab === 'advanced'}
              isOpen={open}
              modelGroups={modelGroups}
              modelOptions={modelOptions}
              onSettingsChanged={onSettingsChanged}
            />
          </TabsPanel>
        </Tabs>

        <p className="border-t border-line pt-4 text-center text-xs text-fg-subtle">v{version}</p>
      </div>
    </Modal>
  );
}
