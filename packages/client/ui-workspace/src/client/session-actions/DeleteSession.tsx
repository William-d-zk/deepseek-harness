/**
 * The permanent-delete action: a `sidebar.workspaces.session.menu.item` row and
 * a `sidebar.workspaces.session.row.action` button that raise one destructive
 * confirmation, plus the `shell.overlay` dialog that answers it. Unlike archive
 * — which is reversible and asks only when work still runs — deletion removes
 * the Session's accounting and its durable records, so every deletion is
 * confirmed, and a running Session is deleted only by a confirmation that says
 * it stops that work first.
 */
import { useState } from 'react'
import {
  Button, IconTrashOutlineRegular, MenuItemButton, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteConfirmProps, SessionDeleteConfirmRequest,
  SessionMenuItemProps, SessionRowActionProps,
} from '../contract/slots.ts'
import css from './SessionActions.module.css'

/**
 * Menu row (order 500): ask for the destructive confirmation.
 * @param props - owner share, the menu open state, and the delete share.
 * @returns the row.
 */
export function DeleteSessionMenuItem({
  sessionId, useMenuOpenState, requestSessionDelete, t,
}: SessionMenuItemProps<DeleteSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconTrashOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false)
        requestSessionDelete(sessionId)
      }}
    >
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/**
 * Hover button (order 300): ask for the destructive confirmation.
 * @param props - owner share and the delete share.
 * @returns the button.
 */
export function DeleteSessionRowButton({
  sessionId, requestSessionDelete, t,
}: SessionRowActionProps<DeleteSessionInjected>) {
  return (
    <Tooltip label={t('actions.delete')} side="bottom" align="end" delayMs={500}>
      <button
        type="button"
        className={css.iconButton}
        aria-label={t('menu.deleteSession')}
        onClick={() => { requestSessionDelete(sessionId) }}
      >
        <IconTrashOutlineRegular size={14} />
      </button>
    </Tooltip>
  )
}

/**
 * The `shell.overlay` entry: nothing while no confirmation is pending,
 * otherwise one dialog per request (keyed by the Session). Confirming removes
 * the Session and its records; cancelling leaves everything as it was.
 * @param props - the request hook, its settlement, the delete hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionDeleteConfirmDialog({
  useDeleteRequest, settleSessionDelete, deleteSession, t,
}: SessionDeleteConfirmProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteConfirmForm
      key={request.sessionId}
      request={request}
      deleteSession={deleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

/** One request's dialog: in-flight and error state die with it. */
function DeleteConfirmForm({ request, deleteSession, onSettle, t }: {
  request: SessionDeleteConfirmRequest
  deleteSession: SessionDeleteConfirmProps['deleteSession']
  onSettle: () => void
  t: SessionDeleteConfirmProps['t']
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (deleting) return
    onSettle()
  }
  const confirm = () => {
    setDeleting(true)
    setError(null)
    deleteSession(request.sessionId, request.running).then(() => {
      setDeleting(false)
      onSettle()
    }).catch((reason: unknown) => {
      setDeleting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.session.title')}
      description={t('delete.session.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={css.deleteAction}
            disabled={deleting}
            onClick={confirm}
          >
            {t('delete.session.action')}
          </Button>
        </>
      )}
    >
      <div>{t('delete.session.body')}</div>
      {/* The Host refuses to remove records a turn still writes, so a running
          Session is deleted only by a confirmation that stops the work. */}
      {request.running && <div className={css.deleteWarning}>{t('delete.session.running')}</div>}
      {deleting && <div className={css.deleteStatus} role="status">{t('delete.session.pending')}</div>}
      {error !== null && <div className={css.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
