import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

type Option = { value: string; label: string };

interface IconSelectProps {
  id?: string;
  ariaLabel?: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  className?: string;
}

export function IconSelect({
  id,
  ariaLabel,
  icon,
  value,
  onChange,
  options,
  className = ''
}: IconSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240, renderAbove: false });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedOption = options.find(o => o.value === value);

  // Calculate dropdown position and available space (renders above if there's more room)
  useEffect(() => {
    if (!isOpen) return;

    const DROPDOWN_MAX_HEIGHT = 240; // px (matches max-h-60 ~ 15rem)

    function updatePosition() {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const availableBelow = viewportHeight - rect.bottom; // space below button
      const availableAbove = rect.top; // space above button

      // leave a small margin from viewport edges
      const margin = 8;

      // Prefer rendering below unless there's more space above
      let renderAbove = false;
      if (availableBelow >= DROPDOWN_MAX_HEIGHT || availableBelow >= availableAbove) {
        renderAbove = false;
      } else {
        renderAbove = true;
      }

      // Clamp width to fit within viewport, then clamp left using clamped width
      const width = Math.min(rect.width, viewportWidth - 2 * margin);
      const left = Math.min(
        Math.max(margin, rect.left),
        viewportWidth - width - margin
      );

      if (!renderAbove) {
        const maxHeight = Math.max(40, Math.min(DROPDOWN_MAX_HEIGHT, availableBelow - margin));
        setDropdownPosition({
          top: rect.bottom + 4,
          left,
          width,
          maxHeight,
          renderAbove: false
        });
      } else {
        const maxHeight = Math.max(40, Math.min(DROPDOWN_MAX_HEIGHT, availableAbove - margin));
        // Position the dropdown so its bottom edge touches the top of the button
        // We'll adjust this after measuring the actual height
        const top = Math.max(margin, rect.top - maxHeight);
        setDropdownPosition({
          top,
          left,
          width,
          maxHeight,
          renderAbove: true
        });
      }
    }

    // Calculate initial position
    updatePosition();

    // Handle window events that require repositioning
    const handleReposition = () => {
      updatePosition();
    };

    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [isOpen]);

  // Adjust position after dropdown is rendered to ensure proper alignment
  useEffect(() => {
    if (!isOpen || !dropdownRef.current || !buttonRef.current) return;

    const dropdownEl = dropdownRef.current;
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const margin = 8;

    // Use requestAnimationFrame to ensure the dropdown is fully rendered
    const id = window.requestAnimationFrame(() => {
      const actualHeight = dropdownEl.offsetHeight;

      // If rendering above, position so the dropdown's bottom edge touches the button's top edge
      if (dropdownPosition.renderAbove) {
        const desiredTop = Math.max(margin, buttonRect.top - actualHeight);
        // Only update if there's a meaningful difference to avoid layout thrashing
        if (Math.abs(desiredTop - dropdownPosition.top) > 2) {
          setDropdownPosition(pos => ({ ...pos, top: desiredTop }));
        }
      }
    });

    return () => window.cancelAnimationFrame(id);
  }, [isOpen, dropdownPosition.renderAbove, dropdownPosition.top]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  const buttonClass = `rounded-lg px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 border border-slate-200 dark:border-neutral-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md flex items-center justify-between gap-2 min-w-0 ${className}`;

  const dropdown = isOpen ? (
    <div
      ref={dropdownRef}
      className="fixed py-1 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 rounded-lg shadow-lg backdrop-blur-lg z-[9999] max-h-60 overflow-y-auto"
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
        maxHeight: dropdownPosition.maxHeight,
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors duration-150 ${
            option.value === value
              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
              : 'text-slate-700 dark:text-slate-300'
          }`}
          onClick={() => {
            onChange(option.value);
            setIsOpen(false);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
      {icon ? <span className="w-5 h-5 flex items-center">{icon}</span> : null}
      <button
        ref={buttonRef}
        id={id}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        type="button"
        className={buttonClass}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
      >
        <span className="truncate">{selectedOption?.label || 'Select...'}</span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {typeof window !== 'undefined' && dropdown && createPortal(dropdown, document.body)}
    </div>
  );
}

export default IconSelect;
