import React, { useEffect, useMemo, useState, useRef } from "react";
import api, { formatJPY } from "../lib/api";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { format } from "date-fns";
import { toast } from "sonner";
import { Receipt, Download, FileSpreadsheet, Trash2 } from "lucide-react";
import * as XLSX from "xlsx-js-style";

// Returns the date string (YYYY-MM-DD) relevant to an order's current status.
// Unpaid/ordered orders use start_time (no finish_time yet); paid/complete use finish_time.
const orderDateKey = (o) => {
  const iso = (o.status === "paid" || o.status === "complete") && o.finish_time
    ? o.finish_time
    : o.start_time;
  return iso ? iso.slice(0, 10) : "";
};

const toCsvCell = (value) => {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export default function Reservations() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const knownOrderIds = useRef(new Set());
  const hasLoadedOrders = useRef(false);

  const load = async () => {
    try {
      const { data } = await api.get("/orders");
      // Inside load(), after fetching data:
      const newOrders = hasLoadedOrders.current
        ? data.filter(
            (order) =>
              !knownOrderIds.current.has(order.id) &&
              ["new_order", "ordered", "unpaid"].includes(order.status)
          )
        : [];

      newOrders.forEach((order) => {
        toast.success(
          `New order: Table #${order.table_number} · ${formatJPY(order.total)}`
        );
      });

      data.forEach((order) => knownOrderIds.current.add(order.id));
      hasLoadedOrders.current = true;
      setOrders(data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load orders");
      setOrders([]);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 7500);
    return () => clearInterval(t);
  }, []);

  const markStatus = async (order, status, paymentMethod) => {
    try {
      await api.patch(`/orders/${order.id}/status`, {
        status,
        payment_method: paymentMethod,
      });
      toast.success(`Order marked ${status}`);
      setSelected(null);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to update order status");
    }
  };

  const statusFiltered = filter === "all"
  ? orders
  : orders.filter((order) => {
      if (filter === "new_order") {
        return ["new_order", "ordered", "unpaid"].includes(order.status);
      }
      if (filter === "prepared_order") return order.status === "prepared_order";
      return order.status === filter;
    });

  const filtered = statusFiltered.filter((o) => {
    if (!dateFrom && !dateTo) return true;
    const key = orderDateKey(o);
    if (!key) return false;
    if (dateFrom && key < dateFrom) return false;
    if (dateTo && key > dateTo) return false;
    return true;
  });

  const clearDateFilter = () => { setDateFrom(""); setDateTo(""); };

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error("No orders to export for the current filter");
      return;
    }
    const header = ["Table", "Date", "Start Time", "Finish Time", "Items", "Total (JPY)", "Status", "Payment Method"];
    const rows = filtered.map((o) => [
      o.table_number,
      orderDateKey(o),
      o.start_time ? format(new Date(o.start_time), "yyyy-MM-dd HH:mm") : "",
      o.finish_time ? format(new Date(o.finish_time), "yyyy-MM-dd HH:mm") : "",
      o.items.reduce((s, i) => s + i.quantity, 0),
      o.total || 0,
      o.status === "ordered" ? "unpaid" : o.status,
      o.payment_method || "",
    ]);
    const csv = [header, ...rows].map((r) => r.map(toCsvCell).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = dateFrom || dateTo ? `${dateFrom || "start"}_to_${dateTo || "end"}` : "all";
    link.href = url;
    link.download = `tsuki-sales-report-${stamp}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Sales report exported (CSV)");
  };

  // ---- Professional Excel sales report (xlsx-js-style) ----
  const exportExcel = () => {
    if (filtered.length === 0) {
      toast.error("No orders to export for the current filter");
      return;
    }

    const paidLikeFiltered = filtered.filter((o) => ["paid", "complete"].includes(o.status));
    const unpaidLikeFiltered = filtered.filter((o) => ["unpaid", "ordered"].includes(o.status));
    const totalRevenue = paidLikeFiltered.reduce((s, o) => s + (o.total || 0), 0);
    const totalItems = filtered.reduce((s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0), 0);
    const periodLabel = dateFrom || dateTo
      ? `${dateFrom ? format(new Date(dateFrom), "dd MMM yyyy") : "Start"} – ${dateTo ? format(new Date(dateTo), "dd MMM yyyy") : "Now"}`
      : "All Time";
    const statusLabel = filter === "all" ? "All Statuses" : filter.charAt(0).toUpperCase() + filter.slice(1);

    // ---- Styles ----
    const COLOR_DARK = "1C1C1C";
    const COLOR_ACCENT = "C93A3E";
    const COLOR_HEAD_BG = "2E2520";
    const COLOR_SUB_BG = "F2F0EC";
    const COLOR_BORDER = "D9D3C8";
    const FONT = "Calibri";

    const thin = { style: "thin", color: { rgb: COLOR_BORDER } };
    const allBorders = { top: thin, bottom: thin, left: thin, right: thin };

    const titleStyle = {
      font: { name: FONT, sz: 20, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: COLOR_HEAD_BG } },
      alignment: { horizontal: "left", vertical: "center" },
    };
    const subtitleStyle = {
      font: { name: FONT, sz: 11, italic: true, color: { rgb: "E5E0D8" } },
      fill: { fgColor: { rgb: COLOR_HEAD_BG } },
      alignment: { horizontal: "left", vertical: "center" },
    };
    const metaLabelStyle = {
      font: { name: FONT, sz: 9, bold: true, color: { rgb: "8A817C" } },
      alignment: { horizontal: "left" },
    };
    const metaValueStyle = {
      font: { name: FONT, sz: 11, bold: true, color: { rgb: COLOR_DARK } },
      alignment: { horizontal: "left" },
    };
    const summaryHeaderStyle = {
      font: { name: FONT, sz: 12, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: COLOR_ACCENT } },
      alignment: { horizontal: "left", vertical: "center" },
    };
    const summaryCardLabel = {
      font: { name: FONT, sz: 9, bold: true, color: { rgb: "8A817C" } },
      fill: { fgColor: { rgb: COLOR_SUB_BG } },
      alignment: { horizontal: "center" },
      border: allBorders,
    };
    const summaryCardValue = {
      font: { name: FONT, sz: 14, bold: true, color: { rgb: COLOR_DARK } },
      fill: { fgColor: { rgb: "FFFFFF" } },
      alignment: { horizontal: "center" },
      border: allBorders,
    };
    const tableHeaderStyle = {
      font: { name: FONT, sz: 10, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: COLOR_HEAD_BG } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: allBorders,
    };
    const cellStyle = (alt) => ({
      font: { name: FONT, sz: 10, color: { rgb: COLOR_DARK } },
      fill: { fgColor: { rgb: alt ? "FAF9F7" : "FFFFFF" } },
      alignment: { vertical: "center" },
      border: allBorders,
    });
    const cellStyleCenter = (alt) => ({ ...cellStyle(alt), alignment: { horizontal: "center", vertical: "center" } });
    const cellStyleCurrency = (alt) => ({
      ...cellStyle(alt),
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: '"¥"#,##0',
    });
    const statusBadgeStyle = (status, alt) => {
      const colors = {
        unpaid: { fg: "FDF6E3", text: "8B5A2B" },
        paid: { fg: "F2F4EC", text: "54662C" },
        complete: { fg: "EEF2F7", text: "425466" },
      };
      const c = colors[status] || colors.unpaid;
      return {
        font: { name: FONT, sz: 10, bold: true, color: { rgb: c.text } },
        fill: { fgColor: { rgb: alt ? c.fg : c.fg } },
        alignment: { horizontal: "center", vertical: "center" },
        border: allBorders,
      };
    };
    const totalRowLabel = {
      font: { name: FONT, sz: 11, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: COLOR_DARK } },
      alignment: { horizontal: "right", vertical: "center" },
      border: allBorders,
    };
    const totalRowValue = {
      font: { name: FONT, sz: 11, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: COLOR_DARK } },
      alignment: { horizontal: "right", vertical: "center" },
      numFmt: '"¥"#,##0',
      border: allBorders,
    };
    const totalRowBlank = {
      fill: { fgColor: { rgb: COLOR_DARK } },
      border: allBorders,
    };

    const COLS = 9; // A..I
    const sheetData = [];
    const merges = [];
    const rowStyles = []; // { rowIndex: [ {c, style, v} ] } applied after sheet_add_aoa via direct cell set

    let r = 0;
    // Title block (rows 0-2)
    sheetData[0] = ["TSUKI RESTAURANT", "", "", "", "", "", "", "", ""];
    sheetData[1] = ["Sales Report · Laporan Penjualan", "", "", "", "", "", "", "", ""];
    sheetData[2] = ["", "", "", "", "", "", "", "", ""];
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: COLS - 1 } });
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: COLS - 1 } });
    r = 3;

    // Meta info row
    sheetData[r] = ["Period", "", periodLabel, "", "Status Filter", "", statusLabel, "", ""];
    const metaRow = r;
    r += 1;
    sheetData[r] = ["Generated", "", format(new Date(), "dd MMM yyyy, HH:mm"), "", "Total Orders", "", String(filtered.length), "", ""];
    const metaRow2 = r;
    r += 2;

    // Summary cards header
    sheetData[r] = ["SUMMARY", "", "", "", "", "", "", "", ""];
    const summaryHeaderRow = r;
    merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });
    r += 1;

    const summaryLabelRow = r;
    sheetData[r] = ["Unpaid Orders", "", "Paid Orders", "", "Completed", "", "Total Revenue", "", ""];
    r += 1;
    const summaryValueRow = r;
    sheetData[r] = [
      String(unpaidLikeFiltered.length), "",
      String(filtered.filter((o) => o.status === "paid").length), "",
      String(filtered.filter((o) => o.status === "complete").length), "",
      totalRevenue, "", "",
    ];
    merges.push({ s: { r: summaryLabelRow, c: 0 }, e: { r: summaryLabelRow, c: 1 } });
    merges.push({ s: { r: summaryLabelRow, c: 2 }, e: { r: summaryLabelRow, c: 3 } });
    merges.push({ s: { r: summaryLabelRow, c: 4 }, e: { r: summaryLabelRow, c: 5 } });
    merges.push({ s: { r: summaryLabelRow, c: 6 }, e: { r: summaryLabelRow, c: 8 } });
    merges.push({ s: { r: summaryValueRow, c: 0 }, e: { r: summaryValueRow, c: 1 } });
    merges.push({ s: { r: summaryValueRow, c: 2 }, e: { r: summaryValueRow, c: 3 } });
    merges.push({ s: { r: summaryValueRow, c: 4 }, e: { r: summaryValueRow, c: 5 } });
    merges.push({ s: { r: summaryValueRow, c: 6 }, e: { r: summaryValueRow, c: 8 } });
    r += 2;

    // Detail table header
    const tableHeaderRow = r;
    sheetData[r] = ["No", "Table", "Date", "Start Time", "Finish Time", "Items", "Qty", "Total (¥)", "Status"];
    r += 1;
    const detailStartRow = r;
    filtered.forEach((o, idx) => {
      sheetData[r] = [
        idx + 1,
        o.table_number,
        orderDateKey(o),
        o.start_time ? format(new Date(o.start_time), "HH:mm") : "",
        o.finish_time ? format(new Date(o.finish_time), "HH:mm") : "",
        o.items.map((i) => `${i.quantity}× ${i.name}`).join(", "),
        o.items.reduce((s, i) => s + i.quantity, 0),
        o.total || 0,
        o.status === "ordered" ? "unpaid" : o.status,
      ];
      r += 1;
    });
    const detailEndRow = r - 1;

    // Total row
    const totalRow = r;
    sheetData[r] = ["", "", "", "", "", "", "TOTAL", totalRevenue, ""];
    merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: 5 } });
    r += 1;

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws["!merges"] = merges;
    ws["!cols"] = [
      { wch: 5 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 11 },
      { wch: 40 }, { wch: 7 }, { wch: 13 }, { wch: 12 },
    ];
    ws["!rows"] = [{ hpt: 28 }, { hpt: 20 }];
    ws["!freeze"] = undefined;
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: tableHeaderRow, c: 0 }, e: { r: tableHeaderRow, c: COLS - 1 } }) };
    ws["!views"] = [{ state: "frozen", ySplit: tableHeaderRow + 1, topLeftCell: `A${tableHeaderRow + 2}` }];

    const setCell = (R, C, style) => {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" };
      ws[addr].s = style;
    };

    // Apply title styles
    for (let c = 0; c < COLS; c++) setCell(0, c, titleStyle);
    for (let c = 0; c < COLS; c++) setCell(1, c, subtitleStyle);
    for (let c = 0; c < COLS; c++) setCell(2, c, { fill: { fgColor: { rgb: COLOR_HEAD_BG } } });

    // Meta rows
    [[metaRow, [0, 2, 4, 6]], [metaRow2, [0, 2, 4, 6]]].forEach(([row, labelCols]) => {
      for (let c = 0; c < COLS; c++) {
        const isLabel = c === 0 || c === 4;
        setCell(row, c, isLabel ? metaLabelStyle : metaValueStyle);
      }
    });

    // Summary header
    for (let c = 0; c < COLS; c++) setCell(summaryHeaderRow, c, summaryHeaderStyle);
    // Summary labels/values
    [0, 2, 4, 6].forEach((c) => {
      setCell(summaryLabelRow, c, summaryCardLabel);
      setCell(summaryLabelRow, c + 1, summaryCardLabel);
    });
    [0, 2, 4].forEach((c) => {
      setCell(summaryValueRow, c, summaryCardValue);
      setCell(summaryValueRow, c + 1, summaryCardValue);
    });
    setCell(summaryValueRow, 6, { ...summaryCardValue, numFmt: '"¥"#,##0', font: { ...summaryCardValue.font, color: { rgb: COLOR_ACCENT } } });
    setCell(summaryValueRow, 7, summaryCardValue);
    setCell(summaryValueRow, 8, summaryCardValue);

    // Table header
    for (let c = 0; c < COLS; c++) setCell(tableHeaderRow, c, tableHeaderStyle);

    // Detail rows
    for (let row = detailStartRow; row <= detailEndRow; row++) {
      const alt = (row - detailStartRow) % 2 === 1;
      const order = filtered[row - detailStartRow];
      const status = order.status === "ordered" ? "unpaid" : order.status;
      for (let c = 0; c < COLS; c++) {
        if (c === 7) setCell(row, c, cellStyleCurrency(alt));
        else if (c === 8) setCell(row, c, statusBadgeStyle(status, alt));
        else if (c === 0 || c === 1 || c === 2 || c === 3 || c === 4 || c === 6) setCell(row, c, cellStyleCenter(alt));
        else setCell(row, c, cellStyle(alt));
      }
    }

    // Total row
    for (let c = 0; c < COLS; c++) {
      if (c === 6) setCell(totalRow, c, totalRowLabel);
      else if (c === 7) setCell(totalRow, c, totalRowValue);
      else setCell(totalRow, c, totalRowBlank);
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Report");
    const stamp = dateFrom || dateTo ? `${dateFrom || "start"}_to_${dateTo || "end"}` : "all";
    XLSX.writeFile(wb, `tsuki-sales-report-${stamp}.xlsx`);
    toast.success("Sales report exported (Excel)");
  };

  const deleteOrder = async (order) => {
    const confirmed = window.confirm(
      `Permanently delete the order for Table #${order.table_number} on ${format(new Date(order.start_time), "MMM d, HH:mm")}?`
    );
    if (!confirmed) return;

    try {
      await api.delete(`/orders/${order.id}`);
      toast.success("Order deleted");
      if (selected?.id === order.id) setSelected(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to delete order");
    }
  };

  const normalizeOrderStatus = (status) =>
  ["ordered", "unpaid"].includes(status) ? "new_order" : status;

  const activeCount = orders.filter((o) => o.status === "unpaid" || o.status === "ordered").length;
  const paidCount = orders.filter((o) => o.status === "paid").length;
  const completeCount = orders.filter((o) => o.status === "complete").length;
  const todaysRevenue = orders
    .filter((o) => ["paid", "complete"].includes(o.status))
    .reduce((s, o) => s + (o.total || 0), 0);

  const groupedItems = useMemo(() => {
    if (!selected?.items) return [];

    const groups = new Map();

    selected.items.forEach((item) => {
      const key = item.added_at ? format(new Date(item.added_at), "MMM d, HH:mm") : "Unknown";
      const group = groups.get(key) || [];

      group.push(item);
      groups.set(key, group);
    });

    return Array.from(groups.entries()).map(([addedAt, items]) => ({
      addedAt,
      items,
    }));
  }, [selected]);

  return (
    <div className="p-4 md:p-8 lg:p-12 fade-up" data-testid="reservations-page">
      <div className="mb-8 md:mb-10">
        <div className="label-eyebrow mb-3">Service Floor</div>
        <h1 className="font-serif-jp text-3xl md:text-4xl lg:text-5xl">Reservations</h1>
        <p className="text-sm text-[#8A817C] mt-2">Active orders, totals, and payment status — at a glance.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-8 md:mb-10">
        <StatCard label="Active Orders" value={activeCount} testId="stat-active" />
        <StatCard label="Paid Today" value={paidCount} testId="stat-paid" />
        <div className="col-span-2 md:col-span-1">
          <StatCard label="Revenue" value={formatJPY(todaysRevenue)} testId="stat-revenue" mono />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-8 md:mb-10">
        <StatCard label="Unpaid Queue" value={activeCount} testId="stat-unpaid" />
        <StatCard label="Paid" value={paidCount} testId="stat-paid-count" />
        <StatCard label="Complete" value={completeCount} testId="stat-complete" />
      </div>

      <div className="flex gap-2 mb-6">
        {[
          { v: "all", l: "All" },
          { v: "new_order", l: "New" },
          { v: "prepared_order", l: "Prepared" },
          { v: "paid", l: "Paid" },
          { v: "complete", l: "Complete" },
        ].map((b) => (
          <button
            key={b.v}
            onClick={() => setFilter(b.v)}
            data-testid={`orders-filter-${b.v}`}
            className={`px-4 py-2 text-xs tracking-wider uppercase border rounded-sm transition-colors ${
              filter === b.v
                ? "bg-[#1C1C1C] text-white border-[#1C1C1C]"
                : "bg-white text-[#1C1C1C] border-[#E5E0D8] hover:border-[#1C1C1C]"
            }`}
          >
            {b.l}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-8 bg-white border border-[#E5E0D8] rounded-sm p-4">
        <div>
          <label className="label-eyebrow block mb-2">From</label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            data-testid="orders-date-from"
            className="border border-[#E5E0D8] rounded-sm px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="label-eyebrow block mb-2">To</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            data-testid="orders-date-to"
            className="border border-[#E5E0D8] rounded-sm px-3 py-2 text-sm"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={clearDateFilter}
            data-testid="orders-date-clear"
            className="text-xs text-[#8A817C] hover:text-[#C93A3E] underline underline-offset-2 mb-2.5"
          >
            Clear dates
          </button>
        )}
        <div className="flex-1" />
        <Button
          onClick={exportCsv}
          variant="outline"
          className="rounded-sm h-10"
          data-testid="orders-export-csv"
        >
          <Download size={16} className="mr-2" /> CSV
        </Button>
        <Button
          onClick={exportExcel}
          className="btn-aka rounded-sm h-10"
          data-testid="orders-export-excel"
        >
          <FileSpreadsheet size={16} className="mr-2" /> Export Excel
        </Button>
      </div>

      <div className="hidden md:block bg-white border border-[#E5E0D8] rounded-sm overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b border-[#E5E0D8] text-left">
              <th className="px-6 py-4 label-eyebrow">Table</th>
              <th className="px-6 py-4 label-eyebrow">Started</th>
              <th className="px-6 py-4 label-eyebrow">Finished</th>
              <th className="px-6 py-4 label-eyebrow">Items</th>
              <th className="px-6 py-4 label-eyebrow">Total</th>
              <th className="px-6 py-4 label-eyebrow">Status</th>
              <th className="px-6 py-4 label-eyebrow text-right">Detail</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-[#8A817C]">No orders.</td></tr>
            )}
            {filtered.map((o) => (
              <tr key={o.id} className="border-b border-[#E5E0D8] last:border-0" data-testid={`order-row-${o.id}`}>
                <td className="px-6 py-4 font-serif-jp text-xl">#{o.table_number}</td>
                <td className="px-6 py-4 text-sm">{format(new Date(o.start_time), "MMM d, HH:mm")}</td>
                <td className="px-6 py-4 text-sm text-[#8A817C]">
                  {o.finish_time ? format(new Date(o.finish_time), "MMM d, HH:mm") : "—"}
                </td>
                <td className="px-6 py-4 text-sm">
                  {o.items.reduce((s, i) => s + i.quantity, 0)} item(s)
                </td>
                <td className="px-6 py-4 font-serif-jp text-lg">{formatJPY(o.total)}</td>
                <td className="px-6 py-4">
                  <StatusBadge status={o.status} />
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-4">
                    <button
                      onClick={() => setSelected(o)}
                      data-testid={`order-detail-${o.id}`}
                      className="inline-flex items-center gap-1 text-xs text-[#5C4033] hover:text-[#C93A3E]"
                    >
                      <Receipt size={14} /> View
                    </button>
                    <button
                      onClick={() => deleteOrder(o)}
                      data-testid={`order-delete-${o.id}`}
                      aria-label={`Delete order for Table ${o.table_number}`}
                      className="inline-flex items-center gap-1 text-xs text-[#8A817C] hover:text-[#C93A3E]"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile order cards */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 && (
          <div className="bg-white border border-[#E5E0D8] rounded-sm p-8 text-center text-sm text-[#8A817C]">No orders.</div>
        )}
        {filtered.map((o) => (
          <button
            key={o.id}
            onClick={() => setSelected(o)}
            data-testid={`order-card-${o.id}`}
            className="w-full text-left bg-white border border-[#E5E0D8] rounded-sm p-4 hover:border-[#1C1C1C] transition-colors"
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <div className="font-serif-jp text-2xl leading-none">#{o.table_number}</div>
                <div className="text-xs text-[#8A817C] mt-1">{format(new Date(o.start_time), "MMM d, HH:mm")}</div>
              </div>
              <StatusBadge status={o.status} />
            </div>
            <div className="mt-3 flex justify-between items-baseline">
              <div className="text-xs text-[#5C4033]">{o.items.reduce((s, i) => s + i.quantity, 0)} item(s)</div>
              <div className="font-serif-jp text-xl">{formatJPY(o.total)}</div>
            </div>
          </button>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="rounded-sm max-w-lg" data-testid="order-detail-dialog">
          <DialogHeader>
            <DialogTitle className="font-serif-jp text-2xl">
              Table #{selected?.table_number}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="label-eyebrow mb-1">Started</div>
                  <div>{format(new Date(selected.start_time), "PPp")}</div>
                </div>
                <div>
                  <div className="label-eyebrow mb-1">Status</div>
                  <StatusBadge status={selected.status} />
                </div>
              </div>
              <div className="divider-sumi" />
              <div>
                <div className="label-eyebrow mb-3">Items</div>
                <div className="space-y-4">
                  {groupedItems.map(({ addedAt, items }) => (
                    <div key={addedAt} className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8A817C]">
                        Added at {format(new Date(addedAt), "HH:mm")}
                      </div>

                      {items.map((item, index) => (
                        <div
                          key={`${addedAt}-${index}`}
                          className="flex justify-between text-sm"
                        >
                          <div>
                            <span className="font-medium">{item.quantity}×</span> {item.name}
                              {item.note && (
                            <span className="text-[#8A817C] ml-2">({item.note})</span>
                              )}
                          </div>
                          <div className="font-serif-jp">
                            {formatJPY(item.price * item.quantity)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="divider-sumi" />
              <div className="flex justify-between items-baseline">
                <div className="label-eyebrow">Total</div>
                <div className="font-serif-jp text-3xl">{formatJPY(selected.total)}</div>
              </div>

              {normalizeOrderStatus(selected.status) === "new_order" && (
                <div className="flex gap-2 pt-4">
                  <Button
                    onClick={() => markStatus(selected, "prepared_order")}
                    className="btn-aka flex-1 rounded-sm h-11"
                    data-testid="admin-mark-prepared"
                  >
                    Mark Prepared
                  </Button>
                </div>
              )}

              {normalizeOrderStatus(selected.status) === "prepared_order" && (
                <div className="flex gap-2 pt-4">
                  <Button
                    onClick={() => markStatus(selected, "paid", "verified")}
                    variant="outline"
                    className="flex-1 rounded-sm h-11"
                    data-testid="admin-pay-cashier"
                  >
                    Verify Paid
                  </Button>
                </div>
              )}
              {normalizeOrderStatus(selected.status) === "paid" && (
                <div className="flex gap-2 pt-4">
                  <Button onClick={() => markStatus(selected, "complete")} className="btn-aka flex-1 rounded-sm h-11" data-testid="admin-complete">
                    Mark Complete
                  </Button>
                </div>
              )}
              {normalizeOrderStatus(selected.status) === "complete" && (
                <div className="text-xs text-[#8A817C]">
                  Order completed.
                </div>
              )}
              {normalizeOrderStatus(selected.status) === "paid" && selected.payment_method && (
                <div className="text-xs text-[#8A817C]">
                  {selected.payment_method === "verified" ? "Verified by staff." : `Paid via ${selected.payment_method}.`}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, mono, testId }) {
  return (
    <div className="bg-white border border-[#E5E0D8] rounded-sm p-4 md:p-6" data-testid={testId}>
      <div className="label-eyebrow mb-2 md:mb-3">{label}</div>
      <div className={`${mono ? "font-serif-jp text-2xl md:text-3xl" : "font-serif-jp text-3xl md:text-4xl"}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = ["ordered", "unpaid"].includes(status)
  ? "new_order"
  : status;

  const styles = {
    new_order: "bg-[#FDF6E3] text-[#8B5A2B]",
    prepared_order: "bg-[#E8F1F5] text-[#2F5D6C]",
    paid: "bg-[#F2F4EC] text-[#54662C]",
    complete: "bg-[#EEF2F7] text-[#425466]",
  };

  const labels = {
    new_order: "New Order",
    prepared_order: "Prepared",
    paid: "Paid",
    complete: "Complete",
  };

  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-semibold ${styles[normalized]}`}
    >
      {labels[normalized] || "Unknown"}
    </span>
  );
}