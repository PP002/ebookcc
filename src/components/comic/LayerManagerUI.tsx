import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  GripVertical,
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
  onSelectLayer?: (layerId: string, e?: React.MouseEvent) => void;
  onAddLayer?: () => void;
  onCombineLayers?: () => void;
  onGroupLayers?: () => void;
  onDeleteLayer?: (layerId: string) => void;
  onToggleVisibility?: (layerId: string) => void;
  onToggleGroupVisibility?: (groupId: string) => void;
  onToggleGroupCollapse?: (groupId: string) => void;
  onUpdateLayer?: (layerId: string, updates: Partial<ComicLayer>) => void;
  onUpdateGroup?: (groupId: string, updates: Partial<ComicLayerGroup>) => void;
  onReorderLayers?: (newLayers: ComicLayer[]) => void;
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
  onUpdateGroup = () => {},
  onReorderLayers = () => {},
  className,
}) => {
  // Layer renaming state
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Group renaming state
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');

  // Double tap tracking for mobile / touch devices
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);

  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Drag & drop state for layer reordering
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);

  const activeLayer = layers.find((l) => l.id === activeLayerId) || layers[0];
  const activeGroup = activeLayer?.groupId ? layerGroups.find((g) => g.id === activeLayer.groupId) : null;
  const backgroundLayer = layers.find((l) => l.isBackground) || layers[0];

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
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

  // Group handling map
  const groupsMap = new Map<string, ComicLayerGroup>();
  layerGroups.forEach((g) => groupsMap.set(g.id, g));

  // Layer Rename Handlers
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

  // Group Rename Handlers
  const handleStartRenameGroup = (id: string, currentName: string) => {
    setEditingGroupId(id);
    setEditingGroupName(currentName);
  };

  const handleFinishRenameGroup = (id: string) => {
    if (editingGroupName.trim()) {
      onUpdateGroup(id, { name: editingGroupName.trim() });
    }
    setEditingGroupId(null);
  };

  // Double tap handler for touch devices
  const handleItemTouch = (id: string, type: 'layer' | 'group', currentName: string) => {
    const now = Date.now();
    if (lastTapRef.current && lastTapRef.current.id === id && now - lastTapRef.current.time < 350) {
      // Double tapped!
      if (type === 'layer') {
        handleStartRename(id, currentName);
      } else {
        handleStartRenameGroup(id, currentName);
      }
      lastTapRef.current = null;
    } else {
      lastTapRef.current = { id, time: now };
    }
  };

  // Reorder logic when dropping
  const performReorder = useCallback((sourceId: string, targetId: string, pos: 'above' | 'below') => {
    if (!sourceId || !targetId || sourceId === targetId) return;

    const sourceIdx = layers.findIndex((l) => l.id === sourceId);
    const targetIdx = layers.findIndex((l) => l.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const sourceLayer = layers[sourceIdx];
    const targetLayer = layers[targetIdx];
    if (sourceLayer.isBackground || targetLayer.isBackground) return;

    const filtered = layers.filter((l) => l.id !== sourceId);
    let insertIdx = filtered.findIndex((l) => l.id === targetId);
    if (insertIdx === -1) return;

    // In UI display, top layer is highest index in `layers` array.
    // 'above' in UI means higher z-index (after target in `layers` array)
    // 'below' in UI means lower z-index (before target in `layers` array)
    if (pos === 'above') {
      insertIdx += 1;
    }

    // Ensure background stays at index 0
    const bgIndex = filtered.findIndex((l) => l.isBackground);
    if (insertIdx <= bgIndex) {
      insertIdx = bgIndex + 1;
    }

    const nextLayers = [...filtered];
    nextLayers.splice(insertIdx, 0, sourceLayer);

    onReorderLayers(nextLayers);
  }, [layers, onReorderLayers]);

  // HTML5 Drag Handlers
  const handleDragStart = (e: React.DragEvent, layerId: string) => {
    const layer = layers.find((l) => l.id === layerId);
    if (layer?.isBackground) {
      e.preventDefault();
      return;
    }
    setDraggedLayerId(layerId);
    e.dataTransfer.setData('text/plain', layerId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetLayerId: string) => {
    e.preventDefault();
    if (!draggedLayerId || draggedLayerId === targetLayerId) return;

    const targetLayer = layers.find((l) => l.id === targetLayerId);
    if (targetLayer?.isBackground) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? 'above' : 'below';

    setDragOverLayerId(targetLayerId);
    setDropPosition(pos);
  };

  const handleDragLeave = () => {
    setDragOverLayerId(null);
    setDropPosition(null);
  };

  const handleDrop = (e: React.DragEvent, targetLayerId: string) => {
    e.preventDefault();
    if (!draggedLayerId || !dropPosition || draggedLayerId === targetLayerId) {
      setDraggedLayerId(null);
      setDragOverLayerId(null);
      setDropPosition(null);
      return;
    }

    performReorder(draggedLayerId, targetLayerId, dropPosition);
    setDraggedLayerId(null);
    setDragOverLayerId(null);
    setDropPosition(null);
  };

  const handleDragEnd = () => {
    setDraggedLayerId(null);
    setDragOverLayerId(null);
    setDropPosition(null);
  };

  if (!isOpen) return null;

  // Display layers in stack order (top layer first, background layer last)
  const displayLayers = [...layers].reverse();

  // Distinct groups present
  const renderedGroupIds = new Set<string>();

  return (
    <div
      ref={panelRef}
      className={cn(
        'w-88 bg-popover/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl flex flex-col text-popover-foreground select-none overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 z-50',
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

      {/* Layer Stack with Drag-to-Reorder, Group Folding, Group Opacity, and Front Hide/Show Buttons */}
      <div className="flex-1 overflow-y-auto max-h-80 p-2 space-y-1 divide-y divide-border/20">
        {displayLayers.map((layer) => {
          const isActive = layer.id === activeLayerId;
          const isSelected = selectedLayerIds.includes(layer.id);
          const isBg = Boolean(layer.isBackground);
          const isGrouped = Boolean(layer.groupId);
          const group = layer.groupId ? groupsMap.get(layer.groupId) : null;
          const isGroupCollapsed = Boolean(group?.collapsed);

          // Group Header (Rendered above the first displayed member of this group)
          let renderGroupHeader = false;
          if (group && !renderedGroupIds.has(group.id)) {
            renderedGroupIds.add(group.id);
            renderGroupHeader = true;
          }

          const isDraggingThis = draggedLayerId === layer.id;
          const isDragOverTarget = dragOverLayerId === layer.id;
          const memberCount = group ? layers.filter((l) => l.groupId === group.id).length : 0;
          const groupOpacity = group?.opacity !== undefined ? group.opacity : 1;

          return (
            <React.Fragment key={layer.id}>
              {/* Collapsible Group Header */}
              {renderGroupHeader && group && (
                <div
                  className={cn(
                    'flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold bg-muted/50 border border-border/70 hover:bg-muted transition-colors cursor-pointer my-1 text-foreground shadow-2xs',
                    isGroupCollapsed && 'border-amber-500/40 bg-amber-500/5'
                  )}
                  onClick={() => onToggleGroupCollapse(group.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleStartRenameGroup(group.id, group.name);
                  }}
                  onTouchEnd={() => handleItemTouch(group.id, 'group', group.name)}
                  title="Double click to rename group. Click to toggle fold."
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {/* 1. HIDE/SHOW BUTTON ON THE VERY FRONT */}
                    <button
                      type="button"
                      className={cn(
                        'p-1 rounded text-muted-foreground hover:text-foreground shrink-0 transition-colors',
                        group.visible === false && 'text-muted-foreground/40'
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleGroupVisibility(group.id);
                      }}
                      title={group.visible === false ? 'Show Group' : 'Hide Group'}
                    >
                      {group.visible === false ? (
                        <EyeOff className="w-3.5 h-3.5 text-muted-foreground/50" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {/* Fold/Unfold Toggle Chevron */}
                    <button
                      type="button"
                      className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-transform shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleGroupCollapse(group.id);
                      }}
                      title={isGroupCollapsed ? 'Unfold group' : 'Fold group'}
                    >
                      {isGroupCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-amber-500" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-amber-500" />
                      )}
                    </button>

                    {/* Folder Icon */}
                    {isGroupCollapsed ? (
                      <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    ) : (
                      <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}

                    {/* Group Name / Inline Rename Input */}
                    {editingGroupId === group.id ? (
                      <input
                        type="text"
                        value={editingGroupName}
                        autoFocus
                        onChange={(e) => setEditingGroupName(e.target.value)}
                        onBlur={() => handleFinishRenameGroup(group.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleFinishRenameGroup(group.id);
                          if (e.key === 'Escape') setEditingGroupId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-background border border-primary/60 rounded px-1 py-0.5 text-xs text-foreground focus:outline-none min-w-0"
                      />
                    ) : (
                      <span className="truncate text-[11px] font-semibold select-none min-w-0">
                        {group.name}
                      </span>
                    )}

                    {/* Member Count Badge */}
                    <span className="text-[10px] bg-background/80 border border-border/60 text-muted-foreground px-1.5 py-0.2 rounded-full font-mono shrink-0">
                      {memberCount}
                    </span>
                  </div>

                  {/* Group Opacity Slider Control */}
                  <div
                    className="flex items-center gap-1 shrink-0 ml-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Sliders className="w-3 h-3 text-muted-foreground/70" />
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={groupOpacity}
                      onChange={(e) => {
                        onUpdateGroup(group.id, { opacity: parseFloat(e.target.value) });
                      }}
                      className="w-12 h-1 bg-muted-foreground/30 rounded appearance-none cursor-pointer accent-amber-500"
                      title={`Group Opacity: ${Math.round(groupOpacity * 100)}%`}
                    />
                    <span className="text-[9px] font-mono text-muted-foreground w-6 text-right">
                      {Math.round(groupOpacity * 100)}%
                    </span>
                  </div>
                </div>
              )}

              {/* Layer Row (STRICT: Never displayed when the parent group is folded/collapsed) */}
              {!isGroupCollapsed && (
                <div
                  draggable={!isBg}
                  onDragStart={(e) => handleDragStart(e, layer.id)}
                  onDragOver={(e) => handleDragOver(e, layer.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, layer.id)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    'group relative flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-xs transition-all cursor-pointer border select-none',
                    isGrouped && 'ml-4 border-l-2 border-l-amber-500/50',
                    isSelected
                      ? 'bg-primary/15 border-primary/40 text-foreground font-medium shadow-xs'
                      : isActive
                      ? 'bg-muted/80 border-border text-foreground font-medium'
                      : 'bg-transparent border-transparent hover:bg-muted/40 text-muted-foreground hover:text-foreground',
                    isDraggingThis && 'opacity-40 scale-[0.98] border-dashed border-primary',
                    isDragOverTarget && dropPosition === 'above' && 'border-t-2 border-t-primary shadow-xs',
                    isDragOverTarget && dropPosition === 'below' && 'border-b-2 border-b-primary shadow-xs'
                  )}
                  onClick={(e) => onSelectLayer(layer.id, e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (isBg) {
                      setIsColorPickerOpen(true);
                      colorInputRef.current?.click();
                    } else {
                      handleStartRename(layer.id, layer.name);
                    }
                  }}
                  onTouchEnd={() => {
                    if (!isBg) {
                      handleItemTouch(layer.id, 'layer', layer.name);
                    }
                  }}
                  title={
                    isBg
                      ? 'Double click to change background colour'
                      : 'Click to select. Double click / double tap to rename. Hold and drag to reorder.'
                  }
                >
                  {/* 1. HIDE/SHOW BUTTON ON THE VERY FRONT */}
                  <button
                    type="button"
                    className={cn(
                      'p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors shrink-0',
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
                      <EyeOff className="w-3.5 h-3.5 text-muted-foreground/50" />
                    )}
                  </button>

                  {/* Reorder Drag Handle (for non-background layers) */}
                  {!isBg ? (
                    <div
                      className="text-muted-foreground/50 hover:text-foreground cursor-grab active:cursor-grabbing p-0.5 shrink-0"
                      title="Hold and drag to reorder layer"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div className="w-4 shrink-0" />
                  )}

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
                      </div>
                    )}
                  </div>

                  {/* Layer Opacity Slider upon the layer row */}
                  {!isBg && (
                    <div
                      className="flex items-center gap-1 shrink-0 ml-auto mr-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Sliders className="w-3 h-3 text-muted-foreground/60" />
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={layer.opacity !== undefined ? layer.opacity : 1}
                        onChange={(e) => {
                          onUpdateLayer(layer.id, { opacity: parseFloat(e.target.value) });
                        }}
                        className="w-12 h-1 bg-muted-foreground/30 rounded appearance-none cursor-pointer accent-primary"
                        title={`Opacity: ${Math.round((layer.opacity !== undefined ? layer.opacity : 1) * 100)}%`}
                      />
                      <span className="text-[9px] font-mono text-muted-foreground w-6 text-right">
                        {Math.round((layer.opacity !== undefined ? layer.opacity : 1) * 100)}%
                      </span>
                    </div>
                  )}

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
              )}
            </React.Fragment>
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

      {/* Shortcuts & Guide Footer */}
      <div className="px-3 py-2 border-t border-border/40 bg-muted/40 text-[10px] text-muted-foreground flex flex-col gap-1">
        <div className="flex items-center justify-between font-mono">
          <span><kbd className="bg-background border px-1 py-0.5 rounded text-[9px]">Ctrl+J</kbd> New</span>
          <span><kbd className="bg-background border px-1 py-0.5 rounded text-[9px]">Ctrl+E</kbd> Combine</span>
          <span><kbd className="bg-background border px-1 py-0.5 rounded text-[9px]">Ctrl+G</kbd> Group</span>
        </div>
        <div className="text-[9px] text-muted-foreground/80 flex items-center justify-between pt-0.5 border-t border-border/30">
          <span>• Double tap to rename</span>
          <span>• Hold & drag to reorder</span>
        </div>
      </div>
    </div>
  );
};
