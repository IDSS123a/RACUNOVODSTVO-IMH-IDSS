import { useCallback, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatKM } from '@/features/billing/money';
import { formatDate } from '@/lib/format';
import { useAsyncResult } from '@/lib/use-async-result';
import { saldoText } from '../credit-notes';
import { toast } from 'sonner';
import { listChildBalances, listInvoices, listPrepayments, reversePrepayment, reversePrepaymentUse, type ChildBalance } from '../repository';
import { ChildPrepaidActions, ReceiptButton, ReverseControl } from './PrepaymentActions';
import { PrepaymentDialog } from './PrepaymentDialog';
import { childInvoices } from '../family-invoices';
import { ChildInvoiceList } from './ChildInvoiceList';
import { InvoiceDetailDialog } from './InvoiceDetailDialog';
import { InvoicePdfDialog } from './InvoicePdfDialog';

interface ChildRef {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
}

const saldoColor = (saldo: number): string =>
  saldo < 0 ? 'text-emerald-700 dark:text-emerald-400' : saldo > 0 ? 'text-destructive' : '';

/**
 * „Saldo porodice“ (specs/family-advance, Q1): every child's ledger card, per institution (never mixed):
 * zaduženo − uplaćeno ± preneseno + vraćeno = saldo; negative = u pretplati. The numbers come from the backend
 * (prepayments::child_balances, one definition, M-7). Below each child: payments without an invoice.
 * „Evidentiraj uplatu bez računa“ records money received before any invoice (BR-24 amended). Shown for every
 * family with a child — „nema zaduženja a korisnik plati = u pretplati“.
 * Under each child: its invoices, opened from here (Director, 2026-11-28: the operator moves easily and logically).
 */
export function FamilySaldoCard({
  familyId,
  childList,
  guardians,
}: {
  familyId: string;
  childList: ReadonlyArray<ChildRef>;
  guardians: ReadonlyArray<{ readonly fullName: string }>;
}): React.JSX.Element | null {
  const [recording, setRecording] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [balances, prepayments, invoices] = await Promise.all([
      listChildBalances(familyId),
      listPrepayments(familyId),
      listInvoices({ entity: null, month: null }),
    ]);
    if (!balances.success) return balances;
    if (!prepayments.success) return prepayments;
    if (!invoices.success) return invoices;
    return { success: true as const, data: { balances: balances.data, prepayments: prepayments.data, invoices: invoices.data } };
  }, [familyId]);
  const state = useAsyncResult(load);
  if (childList.length === 0 || state.state.status !== 'ready') return null;
  const { balances, prepayments, invoices } = state.state.data;
  const name = (childId: string | null): string => {
    if (childId === null) return 'Računi bez djeteta';
    const child = childList.find((c) => c.id === childId);
    return child ? `${child.firstName} ${child.lastName}` : 'Dijete';
  };
  const entities = [...new Set(balances.map((b) => b.entity))].sort();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Saldo porodice</CardTitle>
        <CardDescription>
          Za svako dijete posebno: zaduženo (računi umanjeni za knjižna odobrenja) − uplaćeno + vraćeno. Negativan saldo znači da je dijete u pretplati. Ispod svakog djeteta su njegovi računi: klik na broj otvara račun (uplata, storno, opomena), „PDF“ ga prikazuje.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div>
          <Button variant="outline" size="sm" onClick={() => setRecording(true)}>
            <PlusIcon aria-hidden /> Evidentiraj uplatu bez računa (pretplata)…
          </Button>
        </div>
        {entities.length === 0 && <p className="text-muted-foreground">Nema računa ni uplata: saldo 0,00 KM (izmireno).</p>}
        {entities.map((entity) => {
          const rows = balances.filter((b) => b.entity === entity);
          const total = rows.reduce((sum, b) => sum + b.saldo, 0);
          return (
            <section key={entity} className="grid gap-2" aria-label={`Saldo ${entity}`}>
              <p className="font-medium">
                {entity}: <span className={`tabular-nums ${saldoColor(total)}`}>{saldoText(total)}</span>
              </p>
              <ul className="grid gap-2 pl-4">
                {rows.map((b) => (
                  <ChildCard
                    key={`${b.entity}|${b.childId ?? ''}`}
                    balance={b}
                    name={name(b.childId)}
                    invoiceList={<ChildInvoiceList rows={childInvoices(invoices, familyId, b.entity, b.childId)} onOpen={setOpenId} onPdf={setPdfId} />}
                    actions={
                      b.prepaid > 0 ? (
                        <ChildPrepaidActions familyId={familyId} entity={b.entity} childId={b.childId} prepaid={b.prepaid} childList={childList} onDone={state.reload} />
                      ) : null
                    }
                  >
                    {prepayments
                      .filter((p) => p.entity === entity && p.childId === b.childId)
                      .map((p) => (
                        <li key={p.id}>
                          <span className={p.reversedOn ? 'line-through' : undefined}>
                            {formatDate(p.paidOn)} · uplata bez računa {formatKM(p.amount)} · {p.payerName} ({p.payerRelation})
                          </span>
                          {p.reversedOn ? ` · stornirano: ${p.reversalReason ?? ''}` : ` · neiskorišteno ${formatKM(p.remaining)} `}
                          {!p.reversedOn && (
                            <>
                              <ReceiptButton
                                request={{
                                  entity: p.entity,
                                  familyId,
                                  childId: p.childId,
                                  receipt: {
                                    invoiceNumber: null,
                                    paidOn: p.paidOn,
                                    amount: p.amount,
                                    payerName: p.payerName,
                                    payerRelation: p.payerRelation,
                                    childName: name(p.childId),
                                    buyerName: guardians[0]?.fullName ?? '',
                                    purpose: p.note,
                                    reference: p.reference,
                                  },
                                }}
                              />{' · '}
                            </>
                          )}
                          {!p.reversedOn && (
                            <ReverseControl
                              label="Storno uplate"
                              onReverse={async (reason) => {
                                const result = await reversePrepayment(p.id, new Date().toISOString().slice(0, 10), reason);
                                if (!result.success) {
                                  toast.error(result.error);
                                  return false;
                                }
                                toast.success('Uplata bez računa je stornirana.');
                                state.reload();
                                return true;
                              }}
                            />
                          )}
                          <ul className="pl-4">
                            {p.uses.map((u) => (
                              <li key={u.id}>
                                <span className={u.reversedOn ? 'line-through' : undefined}>
                                  {formatDate(u.usedOn)} · {u.invoiceNumber ? `primijenjeno na ${u.invoiceNumber}` : 'vraćeno'} {formatKM(u.amount)} · {u.note}
                                </span>
                                {u.reversedOn ? ` · stornirano: ${u.reversalReason ?? ''}` : ' '}
                                {!u.reversedOn && (
                                  <ReverseControl
                                    label="Storno"
                                    onReverse={async (reason) => {
                                      const result = await reversePrepaymentUse(u.id, new Date().toISOString().slice(0, 10), reason);
                                      if (!result.success) {
                                        toast.error(result.error);
                                        return false;
                                      }
                                      toast.success('Stornirano protuknjiženjem.');
                                      state.reload();
                                      return true;
                                    }}
                                  />
                                )}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                  </ChildCard>
                ))}
              </ul>
            </section>
          );
        })}
      </CardContent>
      <PrepaymentDialog
        familyId={familyId}
        childList={childList}
        guardians={guardians}
        prepayments={prepayments}
        open={recording}
        onClose={() => setRecording(false)}
        onSaved={state.reload}
      />
      <InvoiceDetailDialog
        invoiceId={openId}
        onClose={() => setOpenId(null)}
        onChanged={state.reload}
        onShowPdf={(id) => {
          setOpenId(null);
          setPdfId(id);
        }}
      />
      <InvoicePdfDialog invoiceId={pdfId} onClose={() => setPdfId(null)} />
    </Card>
  );
}

function ChildCard({
  balance: b,
  name,
  actions,
  invoiceList,
  children,
}: {
  balance: ChildBalance;
  name: string;
  actions: React.ReactNode;
  invoiceList: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <li>
      <p>
        <span className="font-medium">{name}</span>:{' '}
        <span className={`font-medium tabular-nums ${saldoColor(b.saldo)}`}>{saldoText(b.saldo)}</span>
      </p>
      <p className="text-muted-foreground">
        zaduženo <span className="tabular-nums">{formatKM(b.charged)}</span> · uplaćeno <span className="tabular-nums">{formatKM(b.received)}</span>
        {b.transferredIn > 0 && <> · preneseno od brata/sestre <span className="tabular-nums">{formatKM(b.transferredIn)}</span></>}
        {b.transferredOut > 0 && <> · preneseno bratu/sestri <span className="tabular-nums">{formatKM(b.transferredOut)}</span></>}
        {b.refunded > 0 && <> · vraćeno <span className="tabular-nums">{formatKM(b.refunded)}</span></>}
        {b.prepaid > 0 && <> · pretplata na raspolaganju <span className="tabular-nums">{formatKM(b.prepaid)}</span></>}
      </p>
      {actions}
      <div className="text-muted-foreground">{invoiceList}</div>
      <ul className="pl-4 text-muted-foreground">{children}</ul>
    </li>
  );
}
