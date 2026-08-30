// Local "New team" creation form — UI only, no API wiring yet.
//
// Replaces the old `teamConsoleUrl('create-team')` external link with an
// in-client modal so the user can draft a team workspace without leaving
// the app. The actual create/invite/billing actions still live in B's
// console; this modal collects the inputs and calls `onCreate` with a
// plain data object the caller can later wire to a real endpoint.

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { modalOverlay, modalContent } from '../motion';
import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './NewTeamModal.module.css';

export interface NewTeamFormValue {
  name: string;
  description: string;
  inviteEmails: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate?: (value: NewTeamFormValue) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewTeamModal({ open, onClose, onCreate }: Props) {
  return (
    <AnimatePresence>
      {open ? <NewTeamModalBody onClose={onClose} onCreate={onCreate} /> : null}
    </AnimatePresence>
  );
}

function NewTeamModalBody({
  onClose,
  onCreate,
}: Omit<Props, 'open'>) {
  const t = useT();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [emailError, setEmailError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  // Focus the name input on mount; lock body scroll; close on Esc.
  useEffect(() => {
    nameRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  function addEmail() {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) {
     setEmailError(t('newTeam.emailInvalid'));
      return;
    }
    const lower = trimmed.toLowerCase();
    if (emails.includes(lower)) {
     setEmailError(t('newTeam.emailDuplicate'));
      return;
    }
    setEmails((prev) => [...prev, lower]);
    setEmailInput('');
    setEmailError(null);
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email));
  }

  function handleEmailKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEmail();
    }
  if (e.key === 'Backspace' && !emailInput && emails.length > 0) {
    const last = emails[emails.length - 1];
    if (last) removeEmail(last);
  }
}

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onCreate?.({
      name: trimmedName,
      description: description.trim(),
      inviteEmails: emails,
    });
    setName('');
    setDescription('');
    setEmails([]);
    setEmailInput('');
    setEmailError(null);
    onClose();
  }

  return (
    <motion.div
      className={styles.backdrop}
      variants={modalOverlay}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className={styles.modal}
        variants={modalContent}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-team-title"
      >
        <header className={styles.head}>
          <div className={styles.headLeft}>
            <Icon name="users" size={18} />
            <h2 id="new-team-title" className={styles.title}>
              {t('newTeam.title')}
            </h2>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t('newTeam.close')}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span className={styles.label}>
              {t('newTeam.nameLabel')}
              <span className={styles.required}>*</span>
            </span>
            <input
              ref={nameRef}
              type="text"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('newTeam.namePlaceholder')}
              maxLength={64}
              autoComplete="off"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>{t('newTeam.descriptionLabel')}</span>
            <textarea
              className={styles.textarea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('newTeam.descriptionPlaceholder')}
              maxLength={280}
              rows={3}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label}>{t('newTeam.inviteLabel')}</span>
            <div className={styles.emailChips}>
              {emails.map((email) => (
                <span key={email} className={styles.chip}>
                  {email}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    onClick={() => removeEmail(email)}
                    aria-label={t('newTeam.removeMember')}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
              <input
                type="email"
                className={styles.emailInput}
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                onKeyDown={handleEmailKeyDown}
                onBlur={addEmail}
                placeholder={t('newTeam.emailPlaceholder')}
                autoComplete="off"
              />
            </div>
            {emailError ? <p className={styles.error}>{emailError}</p> : null}
            <p className={styles.hint}>{t('newTeam.inviteHint')}</p>
          </div>

          <div className={styles.foot}>
            <span className={styles.ownerHint}>{t('newTeam.ownerHint')}</span>
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose}>
                {t('newTeam.cancel')}
              </button>
              <button type="submit" className={styles.submit} disabled={!canSubmit}>
                {t('newTeam.create')}
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
