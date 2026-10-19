import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export default function Select({
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  ariaLabel,
  required = false,
  disabled = false,
  className = '',
}) {
  const generatedId = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const controlled = value !== undefined;
  const initialValue = defaultValue ?? (placeholder ? '' : options[0]?.value ?? '');
  const [internalValue, setInternalValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const selectedValue = controlled ? value : internalValue;
  const selectedIndex = options.findIndex((option) => option.value === selectedValue);
  const [activeIndex, setActiveIndex] = useState(Math.max(selectedIndex, 0));
  const selectedOption = options[selectedIndex];
  const listboxId = `${generatedId}-listbox`;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePress = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [open]);

  const choose = (nextValue) => {
    if (!controlled) setInternalValue(nextValue);
    onValueChange?.(nextValue);
    setInvalid(false);
    setOpen(false);
  };

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(Math.max(selectedIndex, 0));
    setOpen(true);
  };

  const handleKeyDown = (event) => {
    if (disabled || !options.length) return;
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + direction + options.length) % options.length);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(options.length - 1, 0));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) openMenu();
      else if (options[activeIndex]) choose(options[activeIndex].value);
    }
  };

  return <div ref={rootRef} className={`select-control ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${invalid ? 'is-invalid' : ''} ${className}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <select
      className="select-control__native"
      name={name}
      value={selectedValue}
      onChange={(event) => choose(event.target.value)}
      required={required}
      disabled={disabled}
      tabIndex={-1}
      aria-hidden="true"
      hidden
      onInvalid={(event) => {
        event.preventDefault();
        setInvalid(true);
        triggerRef.current?.focus();
      }}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      className={`select-control__trigger ${selectedOption ? '' : 'is-placeholder'}`}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-activedescendant={open && options[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
      aria-required={required}
      aria-invalid={invalid}
      disabled={disabled}
      onClick={() => open ? setOpen(false) : openMenu()}
      onKeyDown={handleKeyDown}
    >
      <span>{selectedOption?.label ?? placeholder ?? 'اختر'}</span>
      <ChevronDown aria-hidden="true" />
    </button>
    {open ? <div className="select-control__menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <button
        type="button"
        role="option"
        id={`${listboxId}-${index}`}
        aria-selected={option.value === selectedValue}
        className={`select-control__option ${index === activeIndex ? 'is-active' : ''} ${option.value === selectedValue ? 'is-selected' : ''}`}
        key={option.value}
        onPointerEnter={() => setActiveIndex(index)}
        onClick={() => choose(option.value)}
      >
        <span>{option.label}</span>
        {option.value === selectedValue ? <Check aria-hidden="true" /> : null}
      </button>)}
    </div> : null}
  </div>;
}
