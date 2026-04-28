"use client"
import { Users } from "lucide-react"
import { useSystemUsers } from "@/components/settings/system-users/use-system-users"
import { UserSearchPanel } from "@/components/settings/system-users/user-search-panel"
import { UserBulkActionsBar } from "@/components/settings/system-users/user-bulk-actions-bar"
import { UserTable } from "@/components/settings/system-users/user-table"
import { UserQuotaDialog } from "@/components/settings/system-users/user-quota-dialog"
import { UserDecisionDialog } from "@/components/settings/system-users/user-decision-dialog"
import { UserConfirmDialog } from "@/components/settings/system-users/user-confirm-dialog"

export function SystemUsersPage() {
  const {
    loading,
    error,
    rows,
    sortedRows,
    pagination,
    search,
    searchDraft,
    setSearchDraft,
    statusFilter,
    sortField,
    sortOrder,
    selectedIds,
    quotaDialogOpen,
    quotaTarget,
    quotaSnapshot,
    quotaLoading,
    quotaSubmitting,
    quotaError,
    quotaForm,
    decisionDialog,
    confirmState,
    confirmLoading,
    confirmMeta,
    actionUserId,
    refresh,
    onSearch,
    onClearSearch,
    handleStatusFilterChange,
    toggleSort,
    toggleSelectAll,
    toggleSelectRow,
    handleBatchEnable,
    handleBatchDisable,
    handleBatchDelete,
    clearSelection,
    openQuotaDialog,
    handleQuotaDialogOpenChange,
    setQuotaForm,
    handleQuotaSave,
    openDecisionDialog,
    closeDecisionDialog,
    submitDecisionDialog,
    updateDecisionReason,
    confirmApprove,
    confirmEnable,
    confirmChangeRole,
    confirmDelete,
    closeConfirm,
    runConfirmAction,
    changePageSize,
    goToPage,
  } = useSystemUsers()

  const selectedCount = selectedIds.size

  return (
    <div className="space-y-4">
      <section className="v2-panel p-4 shadow-none sm:p-5">
        <div className="mb-4 flex items-start gap-3 border-b border-border/70 pb-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h2 className="v2-section-title">用户管理</h2>
            <p className="v2-muted-line mt-1">管理系统用户、审批注册、调整权限和额度。</p>
          </div>
        </div>

        <UserSearchPanel
          searchDraft={searchDraft}
          setSearchDraft={setSearchDraft}
          search={search}
          loading={loading}
          statusFilter={statusFilter}
          onSearch={onSearch}
          onClearSearch={onClearSearch}
          onStatusFilterChange={handleStatusFilterChange}
          onRefresh={refresh}
        />
      </section>

      {error && (
        <div className="text-sm text-destructive px-4 py-3 bg-destructive/10 rounded border border-destructive/20">
          {error}
        </div>
      )}

      <UserBulkActionsBar
        selectedCount={selectedCount}
        loading={loading}
        onEnable={handleBatchEnable}
        onDisable={handleBatchDisable}
        onDelete={handleBatchDelete}
        onClear={clearSelection}
      />

      <div className="space-y-3">
        <h2 className="v2-section-title">用户列表</h2>
        <UserTable
          loading={loading}
          rows={rows}
          sortedRows={sortedRows}
          search={search}
          selectedIds={selectedIds}
          toggleSelectAll={toggleSelectAll}
          toggleSelectRow={toggleSelectRow}
          quotaSubmitting={quotaSubmitting}
          actionUserId={actionUserId}
          openQuotaDialog={openQuotaDialog}
          confirmApprove={confirmApprove}
          confirmEnable={confirmEnable}
          confirmChangeRole={confirmChangeRole}
          confirmDelete={confirmDelete}
          openDecisionDialog={openDecisionDialog}
          pagination={pagination}
          changePageSize={changePageSize}
          goToPage={goToPage}
          sortField={sortField}
          sortOrder={sortOrder}
          toggleSort={toggleSort}
        />
      </div>

      <UserQuotaDialog
        open={quotaDialogOpen}
        onOpenChange={handleQuotaDialogOpenChange}
        target={quotaTarget}
        snapshot={quotaSnapshot}
        loading={quotaLoading}
        submitting={quotaSubmitting}
        error={quotaError}
        form={quotaForm}
        setForm={setQuotaForm}
        onSave={handleQuotaSave}
      />

      <UserDecisionDialog
        state={decisionDialog}
        onClose={closeDecisionDialog}
        onChangeReason={updateDecisionReason}
        onSubmit={submitDecisionDialog}
      />

      <UserConfirmDialog
        state={confirmState}
        meta={confirmMeta}
        loading={confirmLoading}
        onConfirm={runConfirmAction}
        onClose={closeConfirm}
      />
    </div>
  )
}
