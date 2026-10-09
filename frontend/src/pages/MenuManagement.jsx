import React, { useEffect, useState } from "react";
import api, { formatJPY } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";



const emptyForm = { name: "", description: "", price: "", category: "main", image_url: "", available: true };

export default function MenuManagement() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [categories, setCategories] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    try {
      const [menuRes, catRes] = await Promise.all([api.get("/menu"), api.get("/categories")]);
      setItems(menuRes.data);
      setCategories(catRes.data.map(c => ({ value: c.slug, label: c.name })));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load menu. Is the backend running?");
      setItems([]);
      setCategories([]);
    }
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description || "",
      price: String(item.price),
      category: item.category,
      image_url: item.image_url || "",
      available: item.available !== false,
    });
    setOpen(true);
  };

  const onImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((current) => ({ ...current, image_url: String(reader.result || "") }));
    };
    reader.readAsDataURL(file);
  };

  const onSave = async (e) => {
    e.preventDefault();
    const payload = { ...form, price: parseInt(form.price, 10) };
    if (!payload.name || isNaN(payload.price)) {
      toast.error("Name and price are required");
      return;
    }
    try {
      if (editing) {
        await api.put(`/menu/${editing.id}`, payload);
        toast.success("Menu item updated");
      } else {
        await api.post("/menu", payload);
        toast.success("Menu item added");
      }
      setOpen(false);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    }
  };

  const onDelete = async (item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    try {
      await api.delete(`/menu/${item.id}`);
      toast.success("Menu item deleted");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to delete menu item");
    }
  };

  const filtered = filter === "all" ? items : items.filter((i) => i.category === filter);

  return (
    <div className="p-4 md:p-8 lg:p-12 fade-up" data-testid="menu-management-page">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-8 md:mb-10">
        <div>
          <div className="label-eyebrow mb-3">Menu Management</div>
          <h1 className="font-serif-jp text-3xl md:text-4xl lg:text-5xl">The Menu</h1>
          <p className="text-sm text-[#8A817C] mt-2">Curate the list of dishes served at Tsuki.</p>
        </div>
        <Button onClick={openAdd} className="btn-aka rounded-sm h-11 px-6" data-testid="menu-add-button">
          <Plus size={16} className="mr-2" /> Add Item
        </Button>
      </div>

      <div className="flex gap-2 mb-8 overflow-x-auto no-scrollbar">
        {[{ value: "all", label: "All" }, ...categories].map((c) => (
          <button
            key={c.value}
            onClick={() => setFilter(c.value)}
            data-testid={`menu-filter-${c.value}`}
            className={`px-4 py-2 text-xs tracking-wider uppercase border rounded-sm transition-colors ${
              filter === c.value
                ? "bg-[#1C1C1C] text-white border-[#1C1C1C]"
                : "bg-white text-[#1C1C1C] border-[#E5E0D8] hover:border-[#1C1C1C]"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Desktop / tablet table */}
      <div className="hidden md:block bg-white border border-[#E5E0D8] rounded-sm overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-[#E5E0D8] text-left">
              <th className="px-6 py-4 label-eyebrow">Item</th>
              <th className="px-6 py-4 label-eyebrow">Category</th>
              <th className="px-6 py-4 label-eyebrow">Price</th>
              <th className="px-6 py-4 label-eyebrow">Status</th>
              <th className="px-6 py-4 label-eyebrow text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-[#8A817C]">No items yet.</td></tr>
            )}
            {filtered.map((item) => (
              <tr key={item.id} className="border-b border-[#E5E0D8] last:border-0" data-testid={`menu-row-${item.id}`}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-4">
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
                        className="w-15 h-15 md:w-20 md:h-20 object-cover rounded-sm"
                      />
                    ) : (
                      <div className="w-15 h-15 md:w-20 md:h-20 bg-[#F2F0EC] rounded-sm" />
                    )}
                  </button>
                    <div>
                      <div className="font-medium">
                        <button type="button" onClick={() => setSelectedItem(item)} className="text-left">
                          {item.name}
                        </button>
                      </div>
                      <div className="text-xs text-[#8A817C] line-clamp-1 max-w-xs">
                        <button type="button" onClick={() => setSelectedItem(item)} className="text-left">
                          {item.description}
                      </button>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 capitalize text-sm">{item.category}</td>
                <td className="px-6 py-4 font-serif-jp text-lg">{formatJPY(item.price)}</td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    item.available !== false
                      ? "bg-[#F2F4EC] text-[#54662C]"
                      : "bg-[#F3EBEB] text-[#8B4A4A]"
                  }`}>
                    {item.available !== false ? "Available" : "Hidden"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button onClick={() => openEdit(item)} data-testid={`menu-edit-${item.id}`}
                    className="inline-flex items-center gap-1 text-xs text-[#5C4033] hover:text-[#C93A3E] mr-4">
                    <Pencil size={14} /> Edit
                  </button>
                  <button onClick={() => onDelete(item)} data-testid={`menu-delete-${item.id}`}
                    className="inline-flex items-center gap-1 text-xs text-[#8A817C] hover:text-[#C93A3E]">
                    <Trash2 size={14} /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 && (
          <div className="bg-white border border-[#E5E0D8] rounded-sm p-8 text-center text-sm text-[#8A817C]">
            No items yet.
          </div>
        )}
        {filtered.map((item) => (
          <div key={item.id} className="bg-white border border-[#E5E0D8] rounded-sm p-4" data-testid={`menu-card-${item.id}`}>
            <div className="flex gap-3">
              {item.image_url ? (
                <img src={item.image_url} alt={item.name} className="w-16 h-16 object-cover rounded-sm flex-shrink-0" />
              ) : (
                <div className="w-16 h-16 bg-[#F2F0EC] rounded-sm flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline gap-2">
                  <div className="font-medium truncate">{item.name}</div>
                  <div className="font-serif-jp text-base whitespace-nowrap">{formatJPY(item.price)}</div>
                </div>
                <div className="text-xs text-[#8A817C] capitalize mt-0.5">{item.category}</div>
                <div className="mt-1">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    item.available !== false
                      ? "bg-[#F2F4EC] text-[#54662C]"
                      : "bg-[#F3EBEB] text-[#8B4A4A]"
                  }`}>
                    {item.available !== false ? "Available" : "Hidden"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-4 mt-3 pt-3 border-t border-[#E5E0D8]">
              <button onClick={() => openEdit(item)} data-testid={`menu-edit-${item.id}`}
                className="inline-flex items-center gap-1 text-xs text-[#5C4033] hover:text-[#C93A3E]">
                <Pencil size={14} /> Edit
              </button>
              <button onClick={() => onDelete(item)} data-testid={`menu-delete-${item.id}`}
                className="inline-flex items-center gap-1 text-xs text-[#8A817C] hover:text-[#C93A3E]">
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-lg" data-testid="menu-form-dialog">
          <DialogHeader>
            <DialogTitle className="font-serif-jp text-2xl">
              {editing ? "Edit Item" : "Add Item"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSave} className="space-y-4">
            <div>
              <Label className="label-eyebrow">Name</Label>
              <Input className="rounded-sm mt-2" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="menu-form-name" required />
            </div>
            <div>
              <Label className="label-eyebrow">Description</Label>
              <Textarea className="rounded-sm mt-2" rows={2} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                data-testid="menu-form-description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="label-eyebrow">Price (¥)</Label>
                <Input type="number" min="0" className="rounded-sm mt-2" value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  data-testid="menu-form-price" required />
              </div>
              <div>
                <Label className="label-eyebrow">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="rounded-sm mt-2" data-testid="menu-form-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <Label className="label-eyebrow">Image URL</Label>
                <Input className="rounded-sm mt-2" value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  data-testid="menu-form-image" placeholder="https://... or paste a data URL" />
              </div>
              <div>
                <Label className="label-eyebrow">Upload Image from Computer</Label>
                <Input
                  type="file"
                  accept="image/*"
                  className="rounded-sm mt-2"
                  onChange={onImageUpload}
                  data-testid="menu-form-image-upload"
                />
              </div>
              {form.image_url && (
                <div className="border border-dashed border-[#E5E0D8] rounded-sm p-3 bg-[#F9F8F6]">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-[#8A817C] mb-2">Preview</div>
                  <img src={form.image_url} alt="Menu preview" className="w-full h-40 object-cover rounded-sm" />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between pt-2">
              <Label className="label-eyebrow">Available</Label>
              <Switch checked={form.available} onCheckedChange={(v) => setForm({ ...form, available: v })}
                data-testid="menu-form-available" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="btn-aka rounded-sm" data-testid="menu-form-submit">
                {editing ? "Save Changes" : "Add Item"}
              </Button>
            </DialogFooter>
          </form>
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
    </div>
  );
}
