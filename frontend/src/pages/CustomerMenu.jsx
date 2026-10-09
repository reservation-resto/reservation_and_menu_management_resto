import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api, { formatJPY } from "../lib/api";
import { Button } from "../components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { toast } from "sonner";
import { Plus, Minus, ShoppingBag, ArrowUp, Menu } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import { decodeTableId } from "../lib/utils";



export default function CustomerMenu() {
  const [params] = useSearchParams();
  const tableNumber = decodeTableId(params.get("table"));
  const nav = useNavigate();
  const {t, i18n} = useTranslation();
  const [menu, setMenu] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [showGoTop, setShowGoTop] = useState(false);
  const [tableValid, setTableValid] = useState(false);
  const lang = (i18n.language || "en").split("-")[0];
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState({}); // { menu_item_id: { quantity, note } }
  const [activeOrder, setActiveOrder] = useState(null);
  const [activeCategory, setActiveCategory] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [qrisOpen, setQrisOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [debugError, setDebugError] = useState(null);

  const goToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const loadAll = useCallback(async () => {
    try {
      const [m, o, c] = await Promise.all([
        api.get("/menu"),
        api.get(`/orders/active`, { params: { table_number: tableNumber } }),
        api.get("/categories"),
      ]);
      setMenu(m.data);
      setActiveOrder(o.data || null);
      const cats = c.data.map(cat => ({
        value: cat.slug,
        label: cat[`name_${lang}`] || cat.name || cat.label || cat.slug,
      }));
      setCategories(cats);
      if (cats.length > 0 && !activeCategory) setActiveCategory(cats[0].value);
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Failed to load customer menu";
      setDebugError({
        detail,
        url: err?.config?.url,
        method: err?.config?.method,
        status: err?.response?.status,
      });
      console.error("loadAll error:", err);
      toast.error(detail);
    }
  }, [activeCategory, tableNumber, lang]);

  useEffect( () => {
    const validateAndLoad = async () => {
      const { data } = await api.get("/tables/validate", { params: { table_number: tableNumber } });
      console.log("Table validation result:", data)
      if (data.valid) {
        loadAll();
        setTableValid(true);
      } else {
        setTableValid(false);
      }
    };
    if (tableNumber) {
      validateAndLoad();
    }

    const onScroll = () => setShowGoTop(window.scrollY > 360);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [tableNumber, loadAll, nav]);

  const grouped = useMemo(() => {
    const g = {};
    categories.forEach((c) => (g[c.value] = []));
    menu.forEach((i) => { if (g[i.category]) g[i.category].push(i); });
    return g;
  }, [menu, categories]);

  const cartItems = Object.entries(cart)
    .map(([id, item]) => {
      const menuItem = menu.find((x) => x.id === id);
      return menuItem && item.quantity > 0
        ? { ...menuItem, quantity: item.quantity, note: item.note || "" }
        : null;
    })
    .filter(Boolean);

  const cartTotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const cartCount = cartItems.reduce((s, i) => s + i.quantity, 0);

  const inc = (id) => setCart((current) => {
    const item = menu.find((x) => x.id === id);

    if (item?.available === false) return current;

    const previous = current[id] || { quantity: 0, note: "" };

    return {
      ...current,
      [id]: {
        ...previous,
        quantity: previous.quantity + 1,
      },
    };
  });

  const dec = (id) => setCart((current) => {
    const previous = current[id] || { quantity: 0, note: "" };
    const quantity = Math.max(0, previous.quantity - 1);

    const next = { ...current, [id]: { ...previous, quantity } };

    if (quantity === 0) delete next[id];

    return next;
  });

  const updateNote = (id, note) => setCart((current) => {
    const previous = current[id] || { quantity: 0, note: "" };

    return {
      ...current,
      [id]: {
        ...previous,
      note,
      },
    };
  });

  const submitOrder = async () => {
    if (cartItems.length === 0) return;
    if (cartItems.some((item) => item.available === false)) {
      toast.error("Some items are out of stock. Remove them before ordering.");
      return;
    }
    setSubmitting(true);
    const hadActiveOrder = !!activeOrder;
    try {
      const items = cartItems.map((item) => ({
        menu_item_id: item.id,
        quantity: item.quantity,
        note: item.note.trim(),
      }));
      if (activeOrder) {
        const { data } = await api.post(`/orders/${activeOrder.id}/items`, { items });
        setActiveOrder(data);
        toast.success("Items added to your order");
      } else {
        const { data } = await api.post(`/orders`, { table_number: tableNumber, items });
        setActiveOrder(data);
        toast.success("Order placed");
      }
      setCart({});
      setCartOpen(false);
      if (!hadActiveOrder) setPayOpen(true);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Order failed");
    } finally {
      setSubmitting(false);
    }
  };

  const choosePayment = async (method) => {
    if (method === "qris") {
      setQrisOpen(true);
      return;
    }
    await api.post(`/orders/${activeOrder.id}/pay`, { payment_method: "cashier" });
    toast.success("Please proceed to the cashier");
    setPayOpen(false);
    loadAll();
  };

  const confirmQris = async () => {
    await api.post(`/orders/${activeOrder.id}/pay`, { payment_method: "qris" });
    toast.success("Payment confirmed");
    setQrisOpen(false);
    setPayOpen(false);
    loadAll();
  };

  if (tableValid == false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9F8F6] p-8" data-testid="no-table">
        <div className="max-w-sm text-center">
          <div className="label-eyebrow mb-3">Sumatera Cafe Resto</div>
          <h1 className="font-serif-jp text-3xl mb-2">いらっしゃいませ !</h1>
          <p className="text-sm text-[#8A817C] mb-6">
            テーブルにあるQRコードを読み取ってください。<br></br>または、レストランのスタッフにお声がけください。
          </p>
          <h1 className="font-serif-jp text-3xl mb-2">Welcome !</h1>
          <p className="text-sm text-[#8A817C] mb-6">
            Please scan the QR code on your table. <br></br>Or contact the restaurant staff.
          </p>
        </div>
      </div>
    );
  }

  if (activeOrder && ["paid", "complete"].includes(activeOrder.status)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9F8F6] p-8" data-testid="paid-screen">
        <div className="max-w-sm text-center">
          <div className="label-eyebrow mb-3">Arigatou Gozaimasu</div>
          <h1 className="font-serif-jp text-4xl mb-3">Thank you.</h1>
          <p className="text-sm text-[#8A817C]">
            Your payment for Table #{tableNumber} has been received via {activeOrder.payment_method}.
          </p>
        </div>
      </div>
    );
  }

  {debugError && (
  <div className="bg-red-100 border border-red-300 text-red-900 p-3 mb-4">
    <div><strong>Debug:</strong> {debugError.detail}</div>
    <div>URL: {debugError.url}</div>
    <div>Method: {debugError.method}</div>
    <div>Status: {debugError.status ?? "none"}</div>
  </div>
)}

  return (
    <div className="min-h-screen bg-[#F9F8F6] pb-32" data-testid="customer-menu-page">
      {/* Hero */}
      <div className="relative h-56 sm:h-64 md:h-80 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1512132411229-c30391241dd8?w=1600&q=80"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/60" />
        <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-10 text-white">
          <div className="label-eyebrow text-white/70 mb-2">Sumatera Cafe Resto</div>
          <h1 className="font-serif-jp text-4xl md:text-5xl" data-testid="customer-table-title">
            {t('table')} <strong>#{tableNumber}</strong> · <br></br>{t('welcome')} !
          </h1>
          <p className="text-white/80 mt-2 max-w-md">
            {t('menu_guide')}
          </p>
        </div>
      </div>

      {/* Active order banner */}
      {activeOrder && (
        <div className="bg-[#FDF6E3] border-y border-[#E5E0D8] px-4 sm:px-6 py-3 flex items-center justify-between gap-3" data-testid="active-order-banner">
          <div className="text-xs sm:text-sm text-[#8B5A2B] min-w-0">
            <span className="font-semibold">{t('order in progress')}</span>
            <span className="hidden sm:inline"> · {activeOrder.items.reduce((s, i) => s + i.quantity, 0)} {t('items')}</span>
            <span> · {formatJPY(activeOrder.total)}</span>
          </div>
          <Button onClick={() => setPayOpen(true)} size="sm" className="btn-aka rounded-sm h-9 px-4 text-xs flex-shrink-0" data-testid="open-payment-button">
            {t('view order')}
          </Button>
        </div>
      )}

      {/* Category nav */}
      <div className="sticky top-0 z-20 bg-[#F9F8F6]/95 backdrop-blur border-b border-[#E5E0D8]">      
        <div className="row flex items-center justify-between gap-4 px-4 py-3">
          <button className="md:hidden px-3 py-2 text-sm border rounded-sm"
            onClick={() => setCategoryOpen((open) => !open)}
            >
            <Menu size={18} />
          </button>
          <div className={`hidden md:block`}>
            <div className="flex gap-1 overflow-x-auto no-scrollbar px-4 py-3">
              {categories.map((c) => (
              <button
                key={c.value}
                onClick={() => {
                  setActiveCategory(c.value);
                  document.getElementById(`cat-${c.value}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                data-testid={`category-${c.value}`}
                className={`whitespace-nowrap px-4 py-2 text-xs tracking-wider uppercase border-b-2 transition-colors ${
                  activeCategory === c.value
                    ? "border-[#C93A3E] text-[#1C1C1C]"
                    : "border-transparent text-[#8A817C]"
                }`}
              >
                {c.label}
              </button>
              ))}
            </div>
          </div>
          <LanguageSwitcher/>
        </div>
        <div className={`${categoryOpen ? "block" : "hidden"} md:hidden`}>
          <div className="row flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex gap-1 overflow-x-auto no-scrollbar px-4 py-3">
              {categories.map((c) => (
              <button
                key={c.value}
                onClick={() => {
                  setActiveCategory(c.value);
                  document.getElementById(`cat-${c.value}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                data-testid={`category-${c.value}`}
                className={`whitespace-nowrap px-4 py-2 text-xs tracking-wider uppercase border-b-2 transition-colors ${
                  activeCategory === c.value
                    ? "border-[#C93A3E] text-[#1C1C1C]"
                    : "border-transparent text-[#8A817C]"
                }`}
              >
                {c.label}
              </button>
              ))}
            </div>
          </div>
        </div>        
      </div>

      {/* Items */}
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-12">
        {categories.map((c) => (
          <section key={c.value} id={`cat-${c.value}`}>
            <div className="label-eyebrow mb-4">{c.label}</div>
            <div className="space-y-4">
              {grouped[c.value].length === 0 && (
                <div className="text-sm text-[#8A817C]">Nothing here yet.</div>
              )}
              {grouped[c.value].map((item) => (
                <div key={item.id} className="bg-white border border-[#E5E0D8] rounded-sm p-4 flex gap-4" data-testid={`menu-item-${item.id}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedItem(item)}
                    aria-label={`View ${item.name} details`}
                    className="flex-shrink-0 cursor-zoom-in"
                  >
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="w-24 h-24 md:w-28 md:h-28 object-cover rounded-sm"
                      />
                    ) : (
                      <div className="w-24 h-24 md:w-28 md:h-28 bg-[#F2F0EC] rounded-sm" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-3">
                      <h3 className="font-serif-jp text-xl md:text-2xl">
                        <button type="button" onClick={() => setSelectedItem(item)} className="text-left">
                          {item.name}
                        </button>
                      </h3>
                      <div className="font-serif-jp text-lg whitespace-nowrap">{formatJPY(item.price)}</div>
                    </div>
                    {item.available === false && (
                      <div className="mt-2 inline-flex items-center rounded-full border border-[#C93A3E]/20 bg-[#C93A3E]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#C93A3E]">
                        Out of stock
                      </div>
                    )}
                    <p className="text-xs text-[#8A817C] mt-1 line-clamp-2">
                      <button type="button" onClick={() => setSelectedItem(item)} className="text-left">
                          {item.description}
                      </button>
                    </p>
                    <div className="mt-3 flex justify-end">
                      {cart[item.id] ? (
                        <div className="flex items-center gap-3 border border-[#E5E0D8] rounded-sm">
                          <button onClick={() => dec(item.id)} className="w-9 h-9 flex items-center justify-center hover:bg-[#F2F0EC]" data-testid={`dec-${item.id}`}><Minus size={14} /></button>
                          <span className="text-sm font-semibold w-6 text-center">
                            {cart[item.id].quantity}
                          </span>
                          <button onClick={() => inc(item.id)} disabled={item.available === false} className="w-9 h-9 flex items-center justify-center hover:bg-[#F2F0EC] disabled:cursor-not-allowed disabled:opacity-40" data-testid={`inc-${item.id}`}><Plus size={14} /></button>
                        </div>
                      ) : (
                        <Button onClick={() => inc(item.id)} variant="outline" disabled={item.available === false}
                          className="rounded-sm h-9 px-4 text-xs border-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-white disabled:border-[#B8B1A8] disabled:text-[#B8B1A8] disabled:bg-transparent"
                          data-testid={`add-to-cart-${item.id}`}>
                          {item.available === false ? t('out of stock') : t('add')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Floating cart FAB */}
      {cartCount > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          data-testid="cart-fab"
          className="fixed bottom-4 sm:bottom-6 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 btn-aka rounded-sm px-5 py-3 sm:px-6 sm:py-4 shadow-xl flex items-center justify-between sm:justify-start gap-4 z-30 max-w-md mx-auto"
        >
          <span className="flex items-center gap-2">
            <ShoppingBag size={18} />
            <span className="text-sm font-semibold">{cartCount} {t('items')}</span>
          </span>
          <span className="font-serif-jp text-xl">{formatJPY(cartTotal)}</span>
        </button>
      )}

      {/* Cart drawer */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="rounded-t-sm max-h-[85vh] bg-[#F9F8F6]" data-testid="cart-drawer">
          <SheetHeader>
            <SheetTitle className="font-serif-jp text-2xl text-left">
              {activeOrder ? t('add to order') : t('your order')} · {t('table')} #{tableNumber}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-3 max-h-[50vh] overflow-y-auto">
            {cartItems.map((i) => (
              <div key={i.id} className="flex justify-between items-center bg-white border border-[#E5E0D8] p-3 rounded-sm">
                <div className="flex-m mr-4 min-w-0">
                  <div className="font-medium text-sm">{i.name}</div>
                  <div className="text-xs text-[#8A817C]">{formatJPY(i.price)} {t('each')}</div>
                  {i.available === false && (
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-[#C93A3E]">Out of stock</div>
                  )}
                </div>
                <div className="flex-1 min-w-0 ml-4">
                  <input
                    type="text"
                    value={i.note || ""}
                    onChange={(event) => updateNote(i.id, event.target.value)}
                    placeholder="Add note"
                    maxLength={120}
                    className="mt-2 w-full border border-[#E5E0D8] rounded-sm px-3 py-2 text-xs"
                    aria-label={`Note for ${i.name}`}
                  />
                </div>
                <div className="flex ml-4 items-center gap-2 border border-[#E5E0D8] rounded-sm">
                  <button onClick={() => dec(i.id)} className="w-8 h-8 flex items-center justify-center"><Minus size={14} /></button>
                  <span className="text-sm font-semibold w-6 text-center">{i.quantity}</span>
                  <button onClick={() => inc(i.id)} disabled={i.available === false} className="w-8 h-8 flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"><Plus size={14} /></button>
                </div>
                <div className="font-serif-jp text-lg ml-4 w-20 text-right">{formatJPY(i.price * i.quantity)}</div>
              </div>
            ))}
          </div>
          <div className="divider-sumi my-4" />
          <div className="flex justify-between items-baseline mb-4">
            <div className="label-eyebrow">{t('subtotal')}</div>
            <div className="font-serif-jp text-3xl">{formatJPY(cartTotal)}</div>
          </div>
          <Button onClick={submitOrder} disabled={submitting || cartItems.length === 0 || cartItems.some((item) => item.available === false)}
            className="btn-aka w-full h-12 rounded-sm tracking-wide" data-testid="place-order-button">
            {submitting ? t('placing order') : activeOrder ? t('add to order') : t('place order')}
          </Button>
        </SheetContent>
      </Sheet>

      {/* Payment selection */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="rounded-sm max-w-md" data-testid="payment-dialog">
          <DialogHeader>
            <DialogTitle className="font-serif-jp text-2xl">{t('settle the bill')}</DialogTitle>
          </DialogHeader>
          {activeOrder && (
            <div className="space-y-4">
              <div className="sticky top-0 bg-white border border-[#E5E0D8] rounded-sm p-4 space-y-2 max-h-60 overflow-y-auto">
                {activeOrder.items.map((it, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span>{it.quantity}× {it.name}</span>
                    <span className="font-serif-jp">{formatJPY(it.price * it.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-baseline">
                <div className="label-eyebrow">{t('total')}</div>
                <div className="font-serif-jp text-3xl">{formatJPY(activeOrder.total)}</div>
              </div>
              <div className="grid gap-3 pt-2">
                <Button variant="outline" onClick={() => choosePayment("cashier")}
                  className="btn-aka rounded-sm h-12" data-testid="pay-cashier-button">
                  {t('pay at cashier')}
                </Button>
              </div>
              {/* <div className="grid grid-cols-2 gap-3 pt-2">
                <Button variant="outline" onClick={() => choosePayment("cashier")}
                  className="rounded-sm h-12" data-testid="pay-cashier-button">
                  {t('pay at cashier')}
                </Button>
                <Button onClick={() => choosePayment("qris")}
                  className="btn-aka rounded-sm h-12" data-testid="pay-qris-button">
                  Pay via QRIS
                </Button>
              </div> */}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Menu Preview Modal */}
      <Dialog
        open={!!selectedItem}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedItem(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-sm">
          {selectedItem && (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif-jp text-2xl">
                  {selectedItem.name}
                </DialogTitle>
              </DialogHeader>

              {selectedItem.image_url && (
                <img
                  src={selectedItem.image_url}
                  alt={selectedItem.name}
                  className="max-h-[60vh] w-full rounded-sm object-contain"
                />
              )}

              <p className="whitespace-pre-wrap text-sm text-[#8A817C]">
                {selectedItem.description || "No description available."}
              </p>

              <p className="font-serif-jp text-xl">{formatJPY(selectedItem.price)}</p>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* QRIS modal */}
      <Dialog open={qrisOpen} onOpenChange={setQrisOpen}>
        <DialogContent className="rounded-sm max-w-sm" data-testid="qris-dialog">
          <DialogHeader>
            <DialogTitle className="font-serif-jp text-2xl">QRIS Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-center">
            <p className="text-xs text-[#8A817C]">Scan this with any QRIS-enabled app to complete payment.</p>
            <div className="bg-white p-6 border border-[#E5E0D8] rounded-sm flex justify-center">
              <img
                src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=TSUKI-DEMO-QRIS"
                alt="QRIS"
                className="w-56 h-56"
              />
            </div>
            <div className="font-serif-jp text-2xl">{formatJPY(activeOrder?.total || 0)}</div>
            <Button onClick={confirmQris} className="btn-aka w-full h-11 rounded-sm" data-testid="qris-confirm-button">
              I have paid
            </Button>
            <p className="text-[10px] text-[#8A817C]">Demo simulation · no real transaction is processed.</p>
          </div>
        </DialogContent>
      </Dialog>

      {showGoTop && (
        <button
          onClick={goToTop}
          aria-label="Go to top"
          data-testid="go-top-button"
          className="fixed right-4 bottom-20 z-40 btn-aka rounded-full w-11 h-11 flex items-center justify-center shadow-xl"
        >
          <ArrowUp size={18} />
        </button>
      )}
    </div>
  );
}
