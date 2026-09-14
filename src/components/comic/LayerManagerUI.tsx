import React, { useState, useRef, useEffect } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  Combine,
  ChevronDown,
  ChevronRight,
  Palette,
  Sliders,
  X,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ComicLayer, ComicLayerGroup } from './drawingTypes';

export interface LayerManagerUIProps {
  layers?: ComicLayer[];
  activeLayerId?: string;
  selectedLayerIds?: string[];
  layerGroups?: ComicLayerGroup[];
  isOpen: boolean;
  onClose: () => void;
  onSelectLayer?: (layerId: string, e: React.MouseEvent) => void;
  onAddLayer?: () => void;
  onCombineLayers?: () => void;
  onGroupLayers?: () => void;
  onDeleteLayer?: (layerId: string) => void;
  onToggleVisibility?: (layerId: string) => void;
  onToggleGroupVisibility?: (groupId: string) => void;
  onToggleGroupCollapse?: (groupId: string) => void;
  onUpdateLayer?: (layerId: string, updates: Partial<ComicLayer>) => void;
  onReorderLayers?: (startIndex: number, endIndex: number) => void;
  className?: string;
  engine?: any; // backward-compat
}

const PRESET_BG_COLORS = [
  { label: 'Pure White', color: '#ffffff' },
  { label: 'Warm Cream', color: '#fef3c7' },
  { label: 'Soft Ivory', color: '#f8fafc' },
  { label: 'Muted Sky', color: '#e0f2fe' },
  { label: 'Pale Mint', color: '#dcfce7' },
  { label: 'Pale Lavender', color: '#f3e8ff' },
  { label: 'Warm Amber', color: '#ffedd5' },
  { label: 'Dark Charcoal', color: '#18181b' },
  { label: 'Midnight Blue', color: '#0f172a' },
];

export const LayerManagerUI: React.FC<LayerManagerUIProps> = ({
  layers = [],
  activeLayerId = '',
  selectedLayerIds = [],
  layerGroups = [],
  isOpen,
  onClose,
  onSelectLayer = () => {},
  onAddLayer = () => {},
  onCombineLayers = () => {},
  onGroupLayers = () => {},
  onDeleteLayer = () => {},
  onToggleVisibility = () => {},
  onToggleGroupVisibility = () => {},
  onToggleGroupCollapse = () => {},
  onUpdateLayer = () => {},
  className,
}) => {
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeLayer = layers.find((l) => l.id === activeLayerId) || layers[0];
  const backgroundLayer = layers.find((l) => l.isBackground) || layers[0];

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Only close if not clicking on color picker or dialog
        if (!(e.target as HTMLElement)?.closest?.('.color-picker-trigger')) {
          onClose();
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Keyboard shortcuts inside the component
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        onAddLayer();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        onCombineLayers();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        onGroupLayers();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onAddLayer, onCombineLayers, onGroupLayers]);

  if (!isOpen) return null;

  // Display layers in stack order (top layer first, background layer last)
  const displayLayers = [...layers].reverse();

  const handleStartRename = (id: string, currentName: string) => {
    setEditingLayerId(id);
    setEditingName(currentName);
  };

  const handleFinishRename = (id: string) => {
    if (editingName.trim()) {
      onUpdateLayer(id, { name: editingName.trim() });
    }
    setEditingLayerId(null);
  };

  // Group handling
  const groupsMap = new Map<string, ComicLayerGroup>();
  layerGroups.forEach((g) => groupsMap.set(g.id, g));

  return (
    <div
      ref={panelRef}
      className={cn(
        'w-80 bg-popover/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl flex flex-col text-popover-foreground select-none overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 z-50',
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold tracking-wide uppercase">Layers</span>
          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
            {layers.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={onAddLayer}
            title="Add Layer (Ctrl+J)"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "w-6 h-6 rounded-lg text-muted-foreground hover:text-foreground",
              selectedLayerIds.length < 2 && "opacity-40 cursor-not-allowed"
            )}
            onClick={onCombineLayers}
            disabled={selectedLayerIds.length < 2}
            title="Combine Selected Layers (Ctrl+E)"
          >
            <Combine className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "w-6 h-6 rounded-lg text-muted-foreground hover:text-foreground",
              selectedLayerIds.length < 1 && "opacity-40 cursor-not-allowed"
            )}
            onClick={onGroupLayers}
            disabled={selectedLayerIds.length < 1}
            title="Group Selected Layers (Ctrl+G)"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 rounded-lg text-muted-foreground hover:text-foreground ml-1"
            onClick={onClose}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Layer Stack */}
      <div className="flex-1 overflow-y-auto max-h-72 p-2 space-y-1 divide-y divide-border/20">
        {displayLayers.map((layer) => {
          const isActive = layer.id === activeLayerId;
          const isSelected = selectedLayerIds.includes(layer.id);
          const isBg = Boolean(layer.isBackground);
          const isGrouped = Boolean(layer.groupId);
          const group = layer.groupId ? groupsMap.get(layer.groupId) : null;

          return (
            <div
              key={layer.id}
              className={cn(
                'group relative flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs transition-all cursor-pointer border',
                isGrouped && 'ml-3 border-dashed',
                isSelected
                  ? 'bg-primary/15 border-primary/40 text-foreground font-medium shadow-xs'
                  : isActive
                  ? 'bg-muted/80 border-border text-foreground font-medium'
                  : 'bg-transparent border-transparent hover:bg-muted/40 text-muted-foreground hover:text-foreground'
              )}
              onClick={(e) => onSelectLayer(layer.id, e)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (isBg) {
                  // Double click background layer -> change colour!
                  setIsColorPickerOpen(true);
                  colorInputRef.current?.click();
                } else {
                  handleStartRename(layer.id, layer.name);
                }
              }}
              title={
                isBg
                  ? 'Double click to change background colour'
                  : 'Click to select. Ctrl+Click to multi-select. Shift+Click to range select.'
              }
            >
              {/* Visibility Toggle */}
              <button
                type="button"
                className={cn(
                  'p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors',
                  !layer.visible && 'text-muted-foreground/40'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(layer.id);
                }}
                title={layer.visible ? 'Hide Layer' : 'Show Layer'}
              >
                {layer.visible ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Layer Icon / Swatch */}
              {isBg ? (
                <div
                  className="relative w-4 h-4 rounded border border-border/80 shrink-0 shadow-xs flex items-center justify-center cursor-pointer overflow-hidden group/swatch"
                  style={{ backgroundColor: layer.color || '#ffffff' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsColorPickerOpen(true);
                    colorInputRef.current?.click();
                  }}
                  title="Double click to change colour"
                >
                  <Palette className="w-2.5 h-2.5 text-black/50 mix-blend-difference opacity-0 group-hover/swatch:opacity-100 transition-opacity" />
                </div>
              ) : isGrouped ? (
                <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              ) : (
                <div className="w-3.5 h-3.5 rounded bg-muted border border-border/50 shrink-0 flex items-center justify-center">
                  <span className="text-[9px] font-mono leading-none text-muted-foreground">
                    L
                  </span>
                </div>
              )}

              {/* Layer Name / Inline Edit */}
              <div className="flex-1 min-w-0 flex items-center">
                {editingLayerId === layer.id && !isBg ? (
                  <input
                    type="text"
                    value={editingName}
                    autoFocus
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => handleFinishRename(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleFinishRename(layer.id);
                      if (e.key === 'Escape') setEditingLayerId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-background border border-primary/50 rounded px-1 py-0.5 text-xs text-foreground focus:outline-none"
                  />
                ) : (
                  <div className="flex flex-col min-w-0">
                    <span className="truncate leading-tight">
                      {layer.name}
                    </span>
                    {isBg && (
                      <span className="text-[10px] text-muted-foreground/75 font-normal truncate">
                        Default background ({layer.color || '#ffffff'})
                      </span>
                    )}
                    {group && (
                      <span className="text-[9px] text-amber-500/80 font-normal">
                        in {group.name}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Selection Indicator or Delete Button */}
              <div className="flex items-center gap-1 shrink-0">
                {isBg ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsColorPickerOpen(true);
                      colorInputRef.current?.click();
                    }}
                    className="text-[10px] text-primary hover:underline px-1 py-0.5 rounded"
                    title="Change background colour"
                  >
                    Colour
                  </button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-5 h-5 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteLayer(layer.id);
                    }}
                    title="Delete Layer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hidden Native Color Input for Background Layer */}
      <input
        ref={colorInputRef}
        type="color"
        value={backgroundLayer?.color || '#ffffff'}
        className="sr-only"
        onChange={(e) => {
          if (backgroundLayer) {
            onUpdateLayer(backgroundLayer.id, { color: e.target.value });
          }
        }}
      />

      {/* Quick Background Color Palette (Shown when color picker is triggered) */}
      {isColorPickerOpen && backgroundLayer && (
        <div className="p-3 border-t border-border/60 bg-muted/20 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-primary" />
              Background Colour
            </span>
            <button
              type="button"
              onClick={() => setIsColorPickerOpen(false)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Done
            </button>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {PRESET_BG_COLORS.map((preset) => (
              <button
                key={preset.color}
                type="button"
                className={cn(
                  'w-full h-6 rounded-md border border-border shadow-xs flex items-center justify-center transition-transform hover:scale-105',
                  backgroundLayer.color === preset.color && 'ring-2 ring-primary'
                )}
                style={{ backgroundColor: preset.color }}
                onClick={() => {
                  onUpdateLayer(backgroundLayer.id, { color: preset.color });
                }}
                title={preset.label}
              >
                {backgroundLayer.color === preset.color && (
                  <Check className="w-3 h-3 text-black/70 mix-blend-difference" />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-muted-foreground">Custom:</span>
            <input
              type="color"
              value={backgroundLayer.color || '#ffffff'}
              onChange={(e) => {
                onUpdateLayer(backgroundLayer.id, { color: e.target.value });
              }}
              className="w-6 h-6 rounded border border-border cursor-pointer p-0 bg-transparent"
            />
            <span className="text-[10px] font-mono text-muted-foreground">
              {backgroundLayer.color || '#ffffff'}
            </span>
          </div>
        </div>
      )}

      {/* Active Layer Opacity Controls */}
      {activeLayer && !activeLayer.isBackground && (
        <div className="px-3.5 py-2 border-t border-border/60 bg-muted/15 flex items-center gap-2">
          <Sliders className="w-3 h-3 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground font-medium w-12">
            Opacity
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={activeLayer.opacity !== undefined ? activeLayer.opacity : 1}
            onChange={(e) => {
              onUpdateLayer(activeLayer.id, { opacity: parseFloat(e.target.value) });
            }}
            className="flex-1 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
            {Math.round((activeLayer.opacity !== undefined ? activeLayer.opacity : 1) * 100)}%
          </span>
        </div>
      )}

      {/* Shortcuts Footer */}
      <div className="px-3 py-2 border-t border-border/40 bg-muted/40 text-[10px] text-muted-foreground flex flex-wrap items-center justify-between gap-1">
        <span><kbd className="font-mono font-semibold text-[9px] bg-background border px-1 py-0.5 rounded">Ctrl+J</kbd> New Layer</span>
        <span><kbd className="font-mono font-semibold text-[9px] bg-background border px-1 py-0.5 rounded">Ctrl+E</kbd> Combine</span>
        <span><kbd className="font-mono font-semibold text-[9px] bg-background border px-1 py-0.5 rounded">Ctrl+G</kbd> Group</span>
      </div>
    </div>
  );
};
