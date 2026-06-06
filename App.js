import { FontAwesome, FontAwesome5, Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const API_BASE = "https://zuri-elegance-api.onrender.com";
const WINE = "#50242A";
const GOLD = "#A38560";
const EMERALD = "#07332c";
const CREAM = "#fbf7f1";
const INK = "#2b2023";
const SESSION_KEY = "zuri-elegance-mobile-session-v1";

function money(value) {
  return `R ${Number(value || 0).toFixed(2)}`;
}

function getProductImage(product) {
  return product?.image_url || product?.image_url_2 || product?.image_url_3 || product?.image_url_4 || "";
}

function getFinalPrice(product) {
  const price = Number(product?.price || 0);
  const discount = Math.abs(Number(product?.discount_percent || 0));
  return discount > 0 ? price * (1 - discount / 100) : price;
}

function getAiScore(product) {
  const backendScore = Number(product?.ai_match_score);
  if (Number.isFinite(backendScore) && backendScore > 0) {
    return Math.max(65, Math.min(Math.round(backendScore), 99));
  }

  const rating = Number(product?.average_rating || 0);
  const stock = Number(product?.stock || 0);
  const hasDeal = Number(product?.discount_percent || 0) > 0 || Boolean(product?.promotion_text);
  let score = 84;
  if (rating >= 4.5) score += 8;
  if (rating >= 3.5) score += 4;
  if (hasDeal) score += 3;
  if (stock > 0 && stock <= 3) score += 2;
  return Math.max(65, Math.min(score, 98));
}

function getAiLabel(score) {
  if (score >= 95) return "Best Match";
  if (score >= 90) return "AI Pick";
  if (score >= 85) return "Style Match";
  return "Recommended";
}

function getAiReason(product) {
  if (product?.ai_match_reason) return product.ai_match_reason;
  const text = `${product?.name || ""} ${product?.category || ""} ${product?.description || ""}`.toLowerCase();
  if (text.includes("wig")) return "Chosen for a polished premium hair profile.";
  if (text.includes("closure") || text.includes("frontal")) return "Selected for a sleek, secure beauty finish.";
  if (text.includes("skin") || text.includes("glow")) return "Matched to glow-focused beauty goals.";
  return "Curated from Zuri's boutique beauty edit.";
}

function isHairProduct(product) {
  const text = `${product?.name || ""} ${product?.category || ""} ${product?.brand || ""} ${product?.description || ""}`.toLowerCase();
  return ["hair", "wig", "closure", "frontal", "bundle", "lace"].some((term) => text.includes(term));
}

export default function App() {
  const [screen, setScreen] = useState("login");
  const [user, setUser] = useState(null);
  const [token, setToken] = useState("");
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [orders, setOrders] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [wishlistIds, setWishlistIds] = useState([]);
  const [analyses, setAnalyses] = useState([]);
  const [pendingPayment, setPendingPayment] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([
    {
      role: "assistant",
      content: "Hi, I am Zuri. Tell me what look you want and I will help you pick the right beauty match.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const cartCount = cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
  const wishlistProducts = useMemo(
    () => products.filter((product) => wishlistIds.includes(product.id)),
    [products, wishlistIds]
  );
  const cartTotal = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + Number(item.final_price || item.price || 0) * Number(item.quantity || 1),
        0
      ),
    [cart]
  );

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const saved = await AsyncStorage.getItem(SESSION_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (parsed?.user) {
          setUser(parsed.user);
          setToken(parsed.token || "");
          setCart(Array.isArray(parsed.cart) ? parsed.cart : []);
          setWishlistIds(Array.isArray(parsed.wishlistIds) ? parsed.wishlistIds : []);
          setPendingPayment(parsed.pendingPayment || null);
          setScreen("shop");
        }
      } catch {
        // The app can continue with a fresh session if saved data is unavailable.
      } finally {
        setHydrated(true);
      }
    };

    restoreSession();
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    const saveSession = async () => {
      try {
        if (!user) {
          await AsyncStorage.removeItem(SESSION_KEY);
          return;
        }
        await AsyncStorage.setItem(
          SESSION_KEY,
          JSON.stringify({ user, token, cart, wishlistIds, pendingPayment })
        );
      } catch {
        // Session persistence is a convenience; shopping can still continue.
      }
    };

    saveSession();
  }, [hydrated, user, token, cart, wishlistIds, pendingPayment]);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/products`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load products");
      setProducts(Array.isArray(data) ? data : []);
    } catch (error) {
      Alert.alert("Products", error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadOrders = async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`${API_BASE}/orders/${user.id}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setOrders(data);
    } catch {
      // Orders can refresh again later.
    }
  };

  const loadWishlist = async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`${API_BASE}/wishlist/${user.id}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setWishlistIds(data.map((product) => product.id));
    } catch {
      // Wishlist can retry on the next store load.
    }
  };

  const loadAnalyses = async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`${API_BASE}/beauty-analyses/${user.id}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setAnalyses(data);
    } catch {
      // Beauty analysis history is optional.
    }
  };

  const loadNotifications = async () => {
    if (!user?.id) return;
    try {
      const [notificationsRes, countRes] = await Promise.all([
        fetch(`${API_BASE}/notifications/${user.id}`),
        fetch(`${API_BASE}/notifications/${user.id}/unread-count`),
      ]);
      const notificationsData = await notificationsRes.json();
      const countData = await countRes.json();
      if (notificationsRes.ok && Array.isArray(notificationsData)) {
        setNotifications(notificationsData);
        setUnreadCount(
          Number.isFinite(Number(countData?.unread_count))
            ? Number(countData.unread_count)
            : notificationsData.filter((item) => !item.is_read).length
        );
      }
    } catch {
      // Notifications can refresh again from the bell screen.
    }
  };

  useEffect(() => {
    if (user) {
      loadProducts();
      loadOrders();
      loadWishlist();
      loadAnalyses();
      loadNotifications();
    }
  }, [user]);

  const openProductDetails = (product) => {
    setSelectedProduct(product);
    setScreen("product-detail");
  };

  const login = async (email, password) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      setUser(data.user);
      setToken(data.token || "");
      setScreen("shop");
    } catch (error) {
      Alert.alert("Login", error.message);
    } finally {
      setLoading(false);
    }
  };

  const register = async (form) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      Alert.alert("Account created", "Please log in with your new account.");
      setScreen("login");
    } catch (error) {
      Alert.alert("Register", error.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleWishlist = async (product) => {
    if (!user?.id) return;
    const wasLiked = wishlistIds.includes(product.id);
    setWishlistIds((current) => (wasLiked ? current.filter((id) => id !== product.id) : [...current, product.id]));

    try {
      const res = await fetch(`${API_BASE}/wishlist/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, product_id: product.id }),
      });
      if (!res.ok) throw new Error("Wishlist update failed");
    } catch {
      setWishlistIds((current) => (wasLiked ? [...current, product.id] : current.filter((id) => id !== product.id)));
      Alert.alert("Wishlist", "Could not update your wishlist. Please try again.");
    }
  };

  const addToCart = async (product) => {
    if (!user?.id) {
      setScreen("login");
      return;
    }

    const finalPrice = getFinalPrice(product);
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id || item.product_id === product.id);
      if (existing) {
        return current.map((item) =>
          item.id === product.id || item.product_id === product.id
            ? { ...item, quantity: Number(item.quantity || 1) + 1 }
            : item
        );
      }
      return [...current, { ...product, product_id: product.id, final_price: finalPrice, price: finalPrice, quantity: 1 }];
    });

    try {
      await fetch(`${API_BASE}/cart/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, product_id: product.id, quantity: 1 }),
      });
    } catch {
      // Local cart remains usable if backend cart sync is slow.
    }
  };

  const changeQuantity = (productId, delta) => {
    setCart((current) =>
      current
        .map((item) =>
          item.product_id === productId || item.id === productId
            ? { ...item, quantity: Math.max(0, Number(item.quantity || 1) + delta) }
            : item
        )
        .filter((item) => Number(item.quantity || 0) > 0)
    );
  };

  const startCheckout = async () => {
    if (!cart.length) {
      Alert.alert("Cart", "Your cart is empty.");
      return;
    }
    if (!user?.email || !user?.id) {
      setScreen("login");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/paystack/initialize-order-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          email: user.email,
          delivery_address: user.address || user.city || "Mobile app checkout",
          items: cart.map((item) => ({
            product_id: item.product_id || item.id,
            quantity: item.quantity || 1,
            price: item.final_price || item.price || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.authorization_url) throw new Error(data.error || "Payment could not start");
      setPendingPayment({ reference: data.reference, orderId: data.order_id });
      setScreen("payment");
      await Linking.openURL(data.authorization_url);
    } catch (error) {
      Alert.alert("Checkout", error.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyPayment = async () => {
    if (!pendingPayment?.reference) {
      Alert.alert("Payment", "No pending payment reference found.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/paystack/verify-order-payment?reference=${encodeURIComponent(pendingPayment.reference)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment verification failed");
      setCart([]);
      setPendingPayment(null);
      await loadOrders();
      Alert.alert("Payment confirmed", "Your order is now being processed.");
      setScreen("orders");
    } catch (error) {
      Alert.alert("Payment", error.message);
    } finally {
      setLoading(false);
    }
  };

  const markNotificationRead = async (notification) => {
    if (!notification?.id || notification.is_read) return;
    setNotifications((current) =>
      current.map((item) => (item.id === notification.id ? { ...item, is_read: true } : item))
    );
    setUnreadCount((current) => Math.max(0, current - 1));

    try {
      const res = await fetch(`${API_BASE}/notifications/${notification.id}/read`, { method: "PATCH" });
      if (!res.ok) throw new Error("Notification update failed");
    } catch {
      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, is_read: false } : item))
      );
      setUnreadCount((current) => current + 1);
    }
  };

  const markAllNotificationsRead = async () => {
    if (!user?.id || unreadCount === 0) return;
    const previousNotifications = notifications;
    const previousCount = unreadCount;
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
    setUnreadCount(0);

    try {
      const res = await fetch(`${API_BASE}/notifications/${user.id}/read-all`, { method: "PATCH" });
      if (!res.ok) throw new Error("Notification update failed");
    } catch {
      setNotifications(previousNotifications);
      setUnreadCount(previousCount);
      Alert.alert("Notifications", "Could not mark notifications as read. Please try again.");
    }
  };

  const runBeautyAnalysis = async () => {
    if (!user?.id) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Beauty analysis", "Please allow photo access to upload a selfie or beauty reference.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const form = new FormData();
    form.append("user_id", String(user.id));
    form.append("image", {
      uri: asset.uri,
      name: asset.fileName || `beauty-analysis-${Date.now()}.jpg`,
      type: asset.mimeType || "image/jpeg",
    });

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/analyze-beauty`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Beauty analysis failed");
      setAnalyses((current) => [data, ...current]);
      await loadProducts();
      Alert.alert("Beauty analysis", "Your AI beauty match is ready.");
    } catch (error) {
      Alert.alert("Beauty analysis", error.message);
    } finally {
      setLoading(false);
    }
  };

  const sendAssistantMessage = async () => {
    const content = assistantInput.trim();
    if (!content || !user?.id) return;

    const nextMessages = [...assistantMessages, { role: "user", content }];
    setAssistantMessages(nextMessages);
    setAssistantInput("");

    try {
      const res = await fetch(`${API_BASE}/assistant-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, messages: nextMessages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Assistant chat failed");
      setAssistantMessages((current) => [...current, { role: "assistant", content: data.reply || "I found a few beautiful options for you." }]);
    } catch (error) {
      setAssistantMessages((current) => [
        ...current,
        { role: "assistant", content: error.message || "I could not reply right now. Please try again." },
      ]);
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem(SESSION_KEY);
    } catch {
      // Continue logging out even if storage cleanup fails.
    }
    setUser(null);
    setToken("");
    setCart([]);
    setOrders([]);
    setNotifications([]);
    setUnreadCount(0);
    setWishlistIds([]);
    setAnalyses([]);
    setPendingPayment(null);
    setSelectedProduct(null);
    setAssistantOpen(false);
    setScreen("login");
  };

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.splash}>
          <ActivityIndicator color={WINE} />
          <Text style={styles.loadingText}>Opening Zuri Elegance...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.app}>
        {user && (
          <Header
            screen={screen}
            setScreen={setScreen}
            cartCount={cartCount}
            wishlistCount={wishlistIds.length}
            notificationCount={unreadCount}
            logout={logout}
          />
        )}

        {loading && (
          <View style={styles.loadingBar}>
            <ActivityIndicator color={WINE} />
            <Text style={styles.loadingText}>Working...</Text>
          </View>
        )}

        {!user && screen === "login" && <LoginScreen onLogin={login} goRegister={() => setScreen("register")} />}
        {!user && screen === "register" && <RegisterScreen onRegister={register} goLogin={() => setScreen("login")} />}
        {user && screen === "shop" && (
          <ShopScreen
            products={products}
            analyses={analyses}
            wishlistIds={wishlistIds}
            addToCart={addToCart}
            toggleWishlist={toggleWishlist}
            reload={loadProducts}
            runBeautyAnalysis={runBeautyAnalysis}
            navigate={setScreen}
            openProductDetails={openProductDetails}
          />
        )}
        {user && screen === "wishlist" && (
          <WishlistScreen
            products={wishlistProducts}
            addToCart={addToCart}
            toggleWishlist={toggleWishlist}
            wishlistIds={wishlistIds}
            goShop={() => setScreen("shop")}
            navigate={setScreen}
            openProductDetails={openProductDetails}
          />
        )}
        {user && screen === "cart" && <CartScreen cart={cart} total={cartTotal} changeQuantity={changeQuantity} checkout={startCheckout} navigate={setScreen} />}
        {user && screen === "payment" && <PaymentScreen pendingPayment={pendingPayment} verifyPayment={verifyPayment} goShop={() => setScreen("shop")} navigate={setScreen} />}
        {user && screen === "orders" && <OrdersScreen orders={orders} reload={loadOrders} navigate={setScreen} />}
        {user && screen === "notifications" && (
          <NotificationsScreen
            notifications={notifications}
            unreadCount={unreadCount}
            reload={loadNotifications}
            markRead={markNotificationRead}
            markAllRead={markAllNotificationsRead}
            navigate={setScreen}
          />
        )}
        {user && screen === "product-detail" && selectedProduct && (
          <ProductDetailsScreen
            product={selectedProduct}
            liked={wishlistIds.includes(selectedProduct.id)}
            addToCart={addToCart}
            toggleWishlist={toggleWishlist}
            navigate={setScreen}
          />
        )}
        {user && screen === "profile" && <ProfileScreen user={user} token={token} analyses={analyses} navigate={setScreen} />}
        {user && screen === "beauty-match" && <BeautyMatchScreen analysis={analyses[0]} runBeautyAnalysis={runBeautyAnalysis} navigate={setScreen} />}
        {user && screen === "brands" && <BrandsScreen products={products} navigate={setScreen} />}
        {user && screen === "about" && <InfoScreen type="about" navigate={setScreen} />}
        {user && screen === "contact" && <InfoScreen type="contact" navigate={setScreen} />}
        {user && screen === "privacy" && <PolicyScreen type="privacy" navigate={setScreen} />}
        {user && screen === "terms" && <PolicyScreen type="terms" navigate={setScreen} />}
        {user && screen === "shipping" && <PolicyScreen type="shipping" navigate={setScreen} />}
        {user && screen === "returns" && <PolicyScreen type="returns" navigate={setScreen} />}

        {user && (
          <AssistantChat
            open={assistantOpen}
            setOpen={setAssistantOpen}
            messages={assistantMessages}
            input={assistantInput}
            setInput={setAssistantInput}
            send={sendAssistantMessage}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function Header({ screen, setScreen, cartCount, wishlistCount, notificationCount, logout }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tabs = [
    { key: "shop", label: "Home", icon: "home-outline" },
    { key: "wishlist", label: "Wishlist", icon: "heart-outline", count: wishlistCount },
    { key: "cart", label: "Cart", icon: "cart-outline", count: cartCount },
    { key: "notifications", label: "Notifications", icon: "notifications-outline", count: notificationCount },
    { key: "profile", label: "Profile", icon: "person-outline" },
  ];
  const sidebarLinks = [
    { key: "orders", label: "Orders", icon: "receipt-outline" },
    { key: "brands", label: "Brands", icon: "pricetags-outline" },
    { key: "beauty-match", label: "AI Beauty Match", icon: "sparkles-outline" },
    { key: "about", label: "About", icon: "information-circle-outline" },
    { key: "contact", label: "Contact", icon: "call-outline" },
  ];

  const go = (key) => {
    setScreen(key);
    setMenuOpen(false);
  };

  return (
    <View style={styles.header}>
      <View style={styles.headerBrandRow}>
        <Text style={styles.brandTitle} numberOfLines={1}>Zuri Elegance</Text>
        <Pressable style={styles.logoutButton} onPress={logout}>
          <Ionicons name="log-out-outline" size={17} color="#fff" />
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.headerControlsRow}>
        <Pressable accessibilityLabel="Open menu" style={styles.menuButton} onPress={() => setMenuOpen((current) => !current)}>
          <Ionicons name={menuOpen ? "close" : "menu"} size={28} color="#fff" />
        </Pressable>

        <View style={styles.topIconGroup}>
          {tabs.map((tab) => {
            const active = screen === tab.key;
            return (
              <Pressable key={tab.key} accessibilityLabel={tab.label} onPress={() => go(tab.key)} style={[styles.tab, active && styles.tabActive]}>
                <Ionicons name={tab.icon} size={23} color={active ? "#2b1114" : "#fff"} />
                {tab.count > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{tab.count}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      {menuOpen && (
        <View style={styles.menuPanel}>
          {sidebarLinks.map((tab) => (
            <Pressable key={`menu-${tab.key}`} style={styles.menuItem} onPress={() => go(tab.key)}>
              <Ionicons name={tab.icon} size={20} color={GOLD} />
              <Text style={styles.menuItemText}>{tab.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.menuItem, styles.menuLogout]} onPress={logout}>
            <Ionicons name="log-out-outline" size={20} color="#fff" />
            <Text style={[styles.menuItemText, styles.menuLogoutText]}>Logout</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function LoginScreen({ onLogin, goRegister }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <AuthShell title="Welcome Back" subtitle="Sign in to shop Zuri Elegance from your mobile app.">
      <Field placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <PrimaryButton label="Sign In" onPress={() => onLogin(email.trim(), password)} />
      <TextButton label="Create a new account" onPress={goRegister} />
    </AuthShell>
  );
}

function RegisterScreen({ onRegister, goLogin }) {
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", city: "", password: "" });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <AuthShell title="Create Account" subtitle="Start your Zuri Elegance shopping profile.">
      <Field placeholder="Full name" value={form.full_name} onChangeText={(text) => update("full_name", text)} />
      <Field placeholder="Email" value={form.email} onChangeText={(text) => update("email", text)} keyboardType="email-address" />
      <Field placeholder="Phone" value={form.phone} onChangeText={(text) => update("phone", text)} keyboardType="phone-pad" />
      <Field placeholder="City" value={form.city} onChangeText={(text) => update("city", text)} />
      <Field placeholder="Password" value={form.password} onChangeText={(text) => update("password", text)} secureTextEntry />
      <PrimaryButton label="Create Account" onPress={() => onRegister(form)} />
      <TextButton label="I already have an account" onPress={goLogin} />
    </AuthShell>
  );
}

function AuthShell({ title, subtitle, children }) {
  return (
    <ScrollView contentContainerStyle={styles.authPage}>
      <View style={styles.authCard}>
        <Text style={styles.authKicker}>ZURI ELEGANCE</Text>
        <Text style={styles.authTitle}>{title}</Text>
        <Text style={styles.authSubtitle}>{subtitle}</Text>
        {children}
      </View>
    </ScrollView>
  );
}

function ShopScreen({ products, analyses, wishlistIds, addToCart, toggleWishlist, reload, runBeautyAnalysis, navigate, openProductDetails }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("Recommended");
  const [quickProduct, setQuickProduct] = useState(null);

  const categories = useMemo(() => {
    const values = products.map((product) => product.category || product.brand || "Beauty").filter(Boolean);
    return ["All", ...Array.from(new Set(values)).slice(0, 8)];
  }, [products]);

  const visibleProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = products.filter((product) => {
      const productCategory = product.category || product.brand || "Beauty";
      const text = `${product.name || ""} ${product.description || ""} ${productCategory}`.toLowerCase();
      return (category === "All" || productCategory === category) && (!term || text.includes(term));
    });

    return [...filtered].sort((a, b) => {
      if (sort === "Price low") return getFinalPrice(a) - getFinalPrice(b);
      if (sort === "Price high") return getFinalPrice(b) - getFinalPrice(a);
      return getAiScore(b) - getAiScore(a);
    });
  }, [products, query, category, sort]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <HeroSlider products={products} openProductDetails={openProductDetails} />
      <SearchFilterBar
        query={query}
        setQuery={setQuery}
        categories={categories}
        category={category}
        setCategory={setCategory}
        sort={sort}
        setSort={setSort}
      />
      <BeautyAnalysisCard analysis={analyses[0]} onAnalyze={runBeautyAnalysis} />

      <View style={styles.productsTop}>
        <View>
          <Text style={styles.sectionKicker}>AI BEAUTY PICKS</Text>
          <Text style={styles.sectionTitle}>Recommended For You</Text>
        </View>
        <Text style={styles.resultCount}>{visibleProducts.length} styles</Text>
      </View>

      <View style={styles.productGrid}>
        {visibleProducts.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            liked={wishlistIds.includes(product.id)}
            addToCart={addToCart}
            toggleWishlist={toggleWishlist}
            openQuickView={setQuickProduct}
            openDetails={openProductDetails}
          />
        ))}
      </View>
      {!visibleProducts.length && <EmptyState title="No products found" text="Try another search or filter." />}
      <LuxeFooter navigate={navigate} />
      <QuickViewModal
        product={quickProduct}
        liked={quickProduct ? wishlistIds.includes(quickProduct.id) : false}
        close={() => setQuickProduct(null)}
        addToCart={addToCart}
        toggleWishlist={toggleWishlist}
        openDetails={openProductDetails}
      />
    </ScrollView>
  );
}

function HeroSlider({ products, openProductDetails }) {
  const slides = products.filter((product) => getProductImage(product)).slice(0, 5);
  const fallbackSlides = slides.length ? slides : [{ id: "zuri-slide", name: "Zuri Elegance", category: "AI Beauty Picks" }];

  return (
    <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.heroSlider} contentContainerStyle={styles.heroSliderTrack}>
      {fallbackSlides.map((product) => {
        const image = getProductImage(product);
        return (
          <Pressable key={product.id} style={styles.heroSlide} onPress={() => image && openProductDetails?.(product)}>
            {image ? (
              <Image source={{ uri: image }} style={styles.heroSlideImage} resizeMode="cover" />
            ) : (
              <View style={styles.heroSlideFallback} />
            )}
            <View style={styles.heroSlideOverlay}>
              <Text style={styles.heroSlideKicker}>ZURI ELEGANCE</Text>
              <Text style={styles.heroSlideTitle} numberOfLines={2}>{product.name || "Premium beauty picks"}</Text>
              <Text style={styles.heroSlideText}>{product.category || "AI Beauty Picks"}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function SearchFilterBar({ query, setQuery, categories, category, setCategory, sort, setSort }) {
  const sortOptions = ["Recommended", "Price low", "Price high"];
  return (
    <View style={styles.searchCard}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={20} color={GOLD} />
        <TextInput
          placeholder="Search hair and beauty care..."
          placeholderTextColor="#8a7f82"
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
        />
        {!!query && (
          <Pressable onPress={() => setQuery("")}>
            <Ionicons name="close-circle" size={20} color={WINE} />
          </Pressable>
        )}
      </View>
      <View style={styles.filterTitleRow}>
        <Ionicons name="options-outline" size={17} color={WINE} />
        <Text style={styles.filterTitle}>Filters</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
        {categories.map((item) => (
          <Pressable key={item} style={[styles.filterChip, category === item && styles.filterChipActive]} onPress={() => setCategory(item)}>
            <Text style={[styles.filterChipText, category === item && styles.filterChipTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.sortRow}>
        {sortOptions.map((item) => (
          <Pressable key={item} style={[styles.sortChip, sort === item && styles.sortChipActive]} onPress={() => setSort(item)}>
            <Text style={[styles.sortChipText, sort === item && styles.sortChipTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function HeroSection({ reload }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroTextBlock}>
        <Text style={styles.heroKicker}>AI RECOMMENDED</Text>
        <Text style={styles.heroTitle}>Personal beauty picks selected for you.</Text>
        <Text style={styles.heroText}>Explore AI-ranked wigs, hair care and beauty essentials curated from your Zuri profile.</Text>
        <Pressable style={styles.refreshButton} onPress={reload}>
          <Ionicons name="refresh" size={16} color="#2b1114" />
          <Text style={styles.refreshText}>Refresh Products</Text>
        </Pressable>
      </View>
      <View style={styles.heroBadgeStack}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeNumber}>84%</Text>
          <Text style={styles.heroBadgeText}>AI Match</Text>
        </View>
        <View style={styles.heroMiniCard}>
          <Text style={styles.heroMiniKicker}>SMART EDIT</Text>
          <Text style={styles.heroMiniText}>Recommendations improve after your AI Beauty Match.</Text>
        </View>
      </View>
    </View>
  );
}

function BeautyAnalysisCard({ analysis, onAnalyze }) {
  const tips = Array.isArray(analysis?.tips) ? analysis.tips.slice(0, 2) : [];
  return (
    <View style={styles.analysisCard}>
      <View style={styles.analysisHeader}>
        <View style={styles.analysisIcon}>
          <FontAwesome5 name="crown" size={18} color={GOLD} />
        </View>
      </View>

      <Text style={styles.analysisKicker}>AI BEAUTY MATCH</Text>
      <Text style={styles.analysisTitle}>
        {analysis ? "Your latest beauty profile is ready" : "Find your perfect beauty picks"}
      </Text>
      <Text style={styles.analysisText}>
        {analysis?.summary ||
          "Take your AI Beauty Match and unlock more personal product recommendations."}
      </Text>

      <View style={styles.analysisGrid}>
        <AnalysisMetric icon="color-palette-outline" label="Skin" value={analysis?.skin_type || "Personalized"} />
        <AnalysisMetric icon="cut-outline" label="Hair" value={analysis?.hair_focus || "Style focus"} />
        <AnalysisMetric icon="diamond-outline" label="Goal" value={analysis?.beauty_goal || "Premium look"} />
        <AnalysisMetric icon="happy-outline" label="Face" value={analysis?.face_shape || "Balanced"} />
      </View>

      {tips.length > 0 && (
        <View style={styles.analysisTips}>
          {tips.map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <Ionicons name="checkmark-circle" size={16} color={EMERALD} />
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable style={styles.analysisButton} onPress={onAnalyze}>
        <Text style={styles.analysisButtonText}>{analysis ? "Update Match" : "Start Match"}</Text>
        <Ionicons name="chevron-forward" size={22} color="#2b1114" />
      </Pressable>
    </View>
  );
}

function AnalysisMetric({ icon, label, value }) {
  return (
    <View style={styles.analysisMetric}>
      <Ionicons name={icon} size={17} color={GOLD} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ProductCard({ product, liked, addToCart, toggleWishlist, openQuickView, openDetails, showRemove = false }) {
  const image = getProductImage(product);
  const finalPrice = getFinalPrice(product);
  const discount = Number(product.discount_percent || 0);
  const score = getAiScore(product);

  return (
    <View style={styles.productCard}>
      <View style={styles.productImageWrap}>
        {image ? (
          <Pressable style={styles.productImageTap} onPress={() => openDetails?.(product)}>
            <Image source={{ uri: image }} style={styles.productImage} resizeMode="cover" />
          </Pressable>
        ) : (
          <Pressable style={styles.productImageFallback} onPress={() => openDetails?.(product)}>
            <Text style={styles.productImageFallbackText}>ZE</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityLabel={liked ? "Remove from wishlist" : "Add to wishlist"}
          style={[styles.wishlistButton, liked && styles.wishlistButtonActive]}
          onPress={() => toggleWishlist(product)}
        >
          <Ionicons name={liked ? "heart" : "heart-outline"} size={25} color={liked ? "#fff" : WINE} />
        </Pressable>
        {discount > 0 && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>{discount}% OFF</Text>
          </View>
        )}
      </View>

      <View style={styles.productBody}>
        <Text style={styles.productCategory}>{product.category || product.brand || "Beauty"}</Text>
        <Pressable onPress={() => openDetails?.(product)}>
          <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
        </Pressable>
        <Text style={styles.productDescription} numberOfLines={2}>{getAiReason(product)}</Text>

        <View style={styles.aiMatch}>
          <View style={styles.aiCircle}>
            <Text style={styles.aiCircleText}>{score}%</Text>
          </View>
          <View style={styles.aiCopy}>
            <Text style={styles.aiKicker}>AI MATCH</Text>
            <Text style={styles.aiLabel}>{getAiLabel(score)}</Text>
          </View>
        </View>

        <View style={styles.ratingRow}>
          <Ionicons name="star-outline" size={19} color="#C89B3C" />
          <Text style={styles.ratingText}>
            {Number(product.average_rating || 0).toFixed(0)} ({Number(product.review_count || 0)} reviews)
          </Text>
        </View>

        <View style={styles.productBottom}>
          <View style={styles.priceStack}>
            {discount > 0 && <Text style={styles.oldPrice}>{money(product.price)}</Text>}
            <Text style={styles.price}>{money(finalPrice)}</Text>
          </View>
          <Pressable style={styles.addButton} onPress={() => addToCart(product)}>
            <Ionicons name="cart" size={16} color="#fff" />
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
          {openQuickView && isHairProduct(product) && (
            <Pressable style={styles.quickViewButton} onPress={() => openQuickView?.(product)}>
              <Ionicons name="eye-outline" size={15} color={WINE} />
              <Text style={styles.quickViewButtonText}>Quick View</Text>
            </Pressable>
          )}
          {openDetails && (
            <Pressable style={styles.detailsButton} onPress={() => openDetails(product)}>
              <Ionicons name="open-outline" size={15} color={WINE} />
              <Text style={styles.detailsButtonText}>Details</Text>
            </Pressable>
          )}
          {showRemove && (
            <Pressable style={styles.removeButton} onPress={() => toggleWishlist(product)}>
              <Ionicons name="trash-outline" size={15} color={WINE} />
              <Text style={styles.removeButtonText}>Remove</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function QuickViewModal({ product, liked, close, addToCart, toggleWishlist, openDetails }) {
  if (!product) return null;
  const image = getProductImage(product);
  const discount = Number(product.discount_percent || 0);
  const finalPrice = getFinalPrice(product);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.quickOverlay}>
        <View style={styles.quickSheet}>
          <Pressable style={styles.quickClose} onPress={close}>
            <Ionicons name="close" size={23} color={WINE} />
          </Pressable>
          <View style={styles.quickImageWrap}>
            {image ? (
              <Image source={{ uri: image }} style={styles.quickImage} resizeMode="cover" />
            ) : (
              <View style={styles.productImageFallback}>
                <Text style={styles.productImageFallbackText}>ZE</Text>
              </View>
            )}
          </View>
          <View style={styles.quickBody}>
            <Text style={styles.productCategory}>{product.category || product.brand || "Hair"}</Text>
            <Text style={styles.quickTitle}>{product.name}</Text>
            <Text style={styles.quickText}>{product.description || getAiReason(product)}</Text>
            <View style={styles.quickPriceRow}>
              <View>
                {discount > 0 && <Text style={styles.oldPrice}>{money(product.price)}</Text>}
                <Text style={styles.price}>{money(finalPrice)}</Text>
              </View>
              <View style={styles.aiCircle}>
                <Text style={styles.aiCircleText}>{getAiScore(product)}%</Text>
              </View>
            </View>
            <View style={styles.quickActions}>
              <Pressable style={styles.addButton} onPress={() => addToCart(product)}>
                <Ionicons name="cart" size={16} color="#fff" />
                <Text style={styles.addButtonText}>Add</Text>
              </Pressable>
              <Pressable style={styles.quickWishButton} onPress={() => toggleWishlist(product)}>
                <Ionicons name={liked ? "heart" : "heart-outline"} size={17} color={WINE} />
                <Text style={styles.quickWishText}>{liked ? "Saved" : "Wishlist"}</Text>
              </Pressable>
              {openDetails && (
                <Pressable
                  style={styles.quickWishButton}
                  onPress={() => {
                    close();
                    openDetails(product);
                  }}
                >
                  <Ionicons name="open-outline" size={17} color={WINE} />
                  <Text style={styles.quickWishText}>Details</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ProductDetailsScreen({ product, liked, addToCart, toggleWishlist, navigate }) {
  const image = getProductImage(product);
  const discount = Number(product.discount_percent || 0);
  const finalPrice = getFinalPrice(product);
  const score = getAiScore(product);
  const stock = Number(product.stock || 0);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Pressable style={styles.backButton} onPress={() => navigate("shop")}>
        <Ionicons name="chevron-back" size={18} color={WINE} />
        <Text style={styles.backButtonText}>Back to store</Text>
      </Pressable>

      <View style={styles.detailImageWrap}>
        {image ? (
          <Image source={{ uri: image }} style={styles.detailImage} resizeMode="cover" />
        ) : (
          <View style={styles.productImageFallback}>
            <Text style={styles.productImageFallbackText}>ZE</Text>
          </View>
        )}
        {discount > 0 && (
          <View style={styles.detailDiscount}>
            <Text style={styles.discountText}>{discount}% OFF</Text>
          </View>
        )}
      </View>

      <View style={styles.detailCard}>
        <Text style={styles.productCategory}>{product.category || product.brand || "Beauty"}</Text>
        <Text style={styles.detailTitle}>{product.name}</Text>
        <Text style={styles.detailDescription}>{product.description || getAiReason(product)}</Text>

        <View style={styles.detailPriceRow}>
          <View>
            {discount > 0 && <Text style={styles.oldPrice}>{money(product.price)}</Text>}
            <Text style={styles.price}>{money(finalPrice)}</Text>
          </View>
          <View style={styles.detailMatchPill}>
            <Text style={styles.detailMatchScore}>{score}%</Text>
            <Text style={styles.detailMatchLabel}>{getAiLabel(score)}</Text>
          </View>
        </View>

        <View style={styles.detailSpecGrid}>
          <DetailSpec label="Brand" value={product.brand || "Zuri Edit"} />
          <DetailSpec label="Stock" value={stock > 0 ? `${stock} available` : "Check availability"} />
          <DetailSpec label="Reviews" value={`${Number(product.review_count || 0)} reviews`} />
          <DetailSpec label="AI Note" value={getAiReason(product)} />
        </View>

        <View style={styles.detailActions}>
          <Pressable style={styles.detailAddButton} onPress={() => addToCart(product)}>
            <Ionicons name="cart" size={18} color="#fff" />
            <Text style={styles.addButtonText}>Add to Cart</Text>
          </Pressable>
          <Pressable style={styles.detailWishButton} onPress={() => toggleWishlist(product)}>
            <Ionicons name={liked ? "heart" : "heart-outline"} size={18} color={WINE} />
            <Text style={styles.quickWishText}>{liked ? "Saved" : "Wishlist"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.profileCard}>
        <Text style={styles.sectionKicker}>ZURI STYLING NOTE</Text>
        <Text style={styles.profileSummary}>
          Pair this pick with your AI Beauty Match recommendations for a polished look that suits your profile.
        </Text>
      </View>
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function DetailSpec({ label, value }) {
  return (
    <View style={styles.detailSpec}>
      <Text style={styles.detailSpecLabel}>{label}</Text>
      <Text style={styles.detailSpecValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function WishlistScreen({ products, addToCart, toggleWishlist, wishlistIds, goShop, navigate, openProductDetails }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.simpleHero}>
        <Text style={styles.heroKicker}>WISHLIST</Text>
        <Text style={styles.simpleHeroTitle}>Your saved beauty picks</Text>
        <Text style={styles.heroText}>Keep your favourite wigs and beauty essentials close.</Text>
      </View>
      {!products.length ? (
        <EmptyState title="No wishlist items yet" text="Tap the heart on products you love." action="Browse products" onAction={goShop} />
      ) : (
        <View style={styles.productGrid}>
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              liked={wishlistIds.includes(product.id)}
              addToCart={addToCart}
              toggleWishlist={toggleWishlist}
              openDetails={openProductDetails}
              showRemove
            />
          ))}
        </View>
      )}
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function CartScreen({ cart, total, changeQuantity, checkout, navigate }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.pageTitle}>Your Cart</Text>
      {!cart.length ? (
        <EmptyState title="Your cart is empty" text="Add products from the store to start checkout." />
      ) : (
        <>
          {cart.map((item) => (
            <View key={item.product_id || item.id} style={styles.cartItem}>
              <Text style={styles.cartName}>{item.name}</Text>
              <Text style={styles.cartMeta}>{money(item.final_price || item.price)} each</Text>
              <View style={styles.qtyRow}>
                <Pressable style={styles.qtyButton} onPress={() => changeQuantity(item.product_id || item.id, -1)}>
                  <Text style={styles.qtyText}>-</Text>
                </Pressable>
                <Text style={styles.qtyValue}>{item.quantity}</Text>
                <Pressable style={styles.qtyButton} onPress={() => changeQuantity(item.product_id || item.id, 1)}>
                  <Text style={styles.qtyText}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{money(total)}</Text>
            <Text style={styles.totalHint}>Delivery and VAT may be recalculated securely by the backend.</Text>
            <PrimaryButton label="Checkout with Paystack" onPress={checkout} />
          </View>
        </>
      )}
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function PaymentScreen({ pendingPayment, verifyPayment, goShop, navigate }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.paymentCard}>
        <Text style={styles.heroKicker}>SECURE PAYMENT</Text>
        <Text style={styles.pageTitle}>Complete Paystack payment</Text>
        <Text style={styles.paymentText}>Paystack opened in your browser. When payment is done, return here and confirm your order.</Text>
        <View style={styles.referenceBox}>
          <Text style={styles.referenceLabel}>Reference</Text>
          <Text style={styles.referenceValue}>{pendingPayment?.reference || "Pending"}</Text>
        </View>
        <PrimaryButton label="I have paid, verify order" onPress={verifyPayment} />
        <TextButton label="Continue shopping" onPress={goShop} />
      </View>
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function OrdersScreen({ orders, reload, navigate }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.rowBetween}>
        <Text style={styles.pageTitle}>Orders</Text>
        <Pressable onPress={reload}>
          <Text style={styles.linkText}>Refresh</Text>
        </Pressable>
      </View>
      {!orders.length ? (
        <EmptyState title="No orders yet" text="Your mobile orders will appear here after checkout." />
      ) : (
        orders.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.rowBetween}>
              <Text style={styles.orderTitle}>Order #{order.id}</Text>
              <Text style={styles.orderStatus}>{order.status}</Text>
            </View>
            <Text style={styles.cartMeta}>Reference: {order.reference || "Pending"}</Text>
            <Text style={styles.cartMeta}>Tracking: {order.tracking_number || "Processing"}</Text>
            <Text style={styles.price}>{money(order.total)}</Text>
          </View>
        ))
      )}
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function NotificationsScreen({ notifications, unreadCount, reload, markRead, markAllRead, navigate }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.simpleHero}>
        <Text style={styles.heroKicker}>NOTIFICATIONS</Text>
        <Text style={styles.simpleHeroTitle}>Beauty updates</Text>
        <Text style={styles.heroText}>
          {unreadCount > 0
            ? `${unreadCount} new update${unreadCount === 1 ? "" : "s"} from Zuri Elegance.`
            : "Order alerts, promotions, and Zuri recommendations will appear here."}
        </Text>
        <View style={styles.notificationHeroActions}>
          <Pressable style={styles.refreshButton} onPress={reload}>
            <Ionicons name="refresh" size={16} color="#2b1114" />
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
          {unreadCount > 0 && (
            <Pressable style={styles.markAllButton} onPress={markAllRead}>
              <Text style={styles.markAllButtonText}>Mark all read</Text>
            </Pressable>
          )}
        </View>
      </View>
      {!notifications.length ? (
        <View style={styles.profileCard}>
          <Text style={styles.sectionKicker}>NO NEW ALERTS</Text>
          <Text style={styles.profileSummary}>
            You are all caught up. Check your orders from the sidebar if you want to review recent purchases.
          </Text>
        </View>
      ) : (
        <View style={styles.notificationList}>
          {notifications.map((notification) => (
            <Pressable
              key={notification.id}
              style={[styles.notificationCard, !notification.is_read && styles.notificationCardUnread]}
              onPress={() => markRead(notification)}
            >
              <View style={styles.notificationIcon}>
                <Ionicons
                  name={notification.type === "promotion" ? "pricetag-outline" : notification.type === "order" ? "receipt-outline" : "sparkles-outline"}
                  size={20}
                  color={GOLD}
                />
              </View>
              <View style={styles.notificationCopy}>
                <View style={styles.notificationTitleRow}>
                  <Text style={styles.notificationTitle}>{notification.title || "Zuri Elegance update"}</Text>
                  {!notification.is_read && <View style={styles.unreadDot} />}
                </View>
                <Text style={styles.notificationMessage}>{notification.message || "You have a new update."}</Text>
                <Text style={styles.notificationMeta}>
                  {notification.created_at ? new Date(notification.created_at).toLocaleDateString() : "Just now"}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function ProfileScreen({ user, analyses, navigate }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.pageTitle}>Profile</Text>
      <View style={styles.profileCard}>
        <Info label="Name" value={user?.full_name || "Not set"} />
        <Info label="Email" value={user?.email || "Not set"} />
        <Info label="Phone" value={user?.phone || "Not set"} />
        <Info label="City" value={user?.city || "Not set"} />
      </View>
      <RewardsSection user={user} />
      <View style={styles.profileCard}>
        <Text style={styles.sectionKicker}>BEAUTY HISTORY</Text>
        <Text style={styles.profileSummary}>
          {analyses[0]?.summary || "Run your AI Beauty Match from the shop screen to build your mobile beauty profile."}
        </Text>
      </View>
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function RewardsSection({ user }) {
  const points = Number(user?.reward_points ?? user?.points ?? user?.loyalty_points ?? 0);
  const tier = points >= 1000 ? "Gold Muse" : points >= 500 ? "Rose Muse" : "Beauty Muse";
  const nextReward = points >= 1000 ? "VIP reward unlocked" : `${Math.max(0, 500 - points)} points to your next reward`;

  return (
    <View style={styles.rewardsCard}>
      <View style={styles.rewardsTop}>
        <View>
          <Text style={styles.rewardsKicker}>ZURI REWARDS</Text>
          <Text style={styles.rewardsTitle}>{tier}</Text>
        </View>
        <View style={styles.rewardsIcon}>
          <FontAwesome5 name="crown" size={18} color={GOLD} />
        </View>
      </View>
      <Text style={styles.rewardsPoints}>{points}</Text>
      <Text style={styles.rewardsLabel}>Reward points</Text>
      <View style={styles.rewardsProgress}>
        <View style={[styles.rewardsProgressFill, { width: `${Math.min(100, Math.max(12, (points / 500) * 100))}%` }]} />
      </View>
      <Text style={styles.rewardsHint}>{nextReward}</Text>
    </View>
  );
}

function BeautyMatchScreen({ analysis, runBeautyAnalysis, navigate }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <BeautyAnalysisCard analysis={analysis} onAnalyze={runBeautyAnalysis} />
      <View style={styles.profileCard}>
        <Text style={styles.sectionKicker}>HOW IT WORKS</Text>
        <Text style={styles.profileSummary}>
          Upload a selfie or beauty reference. Zuri reads your beauty goals and updates your recommendations across the store.
        </Text>
      </View>
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function BrandsScreen({ products, navigate }) {
  const brands = Array.from(new Set(products.map((product) => product.brand || product.category || "Zuri Edit"))).slice(0, 12);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.simpleHero}>
        <Text style={styles.heroKicker}>BRANDS</Text>
        <Text style={styles.simpleHeroTitle}>Shop trusted beauty edits</Text>
        <Text style={styles.heroText}>Browse the collections and categories currently available in Zuri Elegance.</Text>
      </View>
      <View style={styles.brandGrid}>
        {brands.map((brand) => (
          <Pressable key={brand} style={styles.brandTile} onPress={() => navigate("shop")}>
            <Ionicons name="pricetag-outline" size={22} color={GOLD} />
            <Text style={styles.brandTileText}>{brand}</Text>
          </Pressable>
        ))}
      </View>
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function InfoScreen({ type, navigate }) {
  const isContact = type === "contact";
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.simpleHero}>
        <Text style={styles.heroKicker}>{isContact ? "CONTACT" : "ABOUT"}</Text>
        <Text style={styles.simpleHeroTitle}>{isContact ? "Talk to Zuri Elegance" : "Luxury beauty, curated for you"}</Text>
        <Text style={styles.heroText}>
          {isContact
            ? "Need help with an order, wig choice, delivery, or beauty match? Reach out and the Zuri team will assist."
            : "Zuri Elegance brings premium hair and beauty essentials together with AI-guided recommendations for your signature look."}
        </Text>
      </View>
      <View style={styles.profileCard}>
        <Text style={styles.sectionKicker}>{isContact ? "SUPPORT" : "ZURI PROMISE"}</Text>
        <Text style={styles.profileSummary}>
          {isContact
            ? "Use the assistant chat for quick product help, or continue shopping and checkout securely with Paystack."
            : "Every product experience is designed to feel polished, personal, and easy to shop from mobile."}
        </Text>
        {isContact && (
          <Pressable style={styles.emailButton} onPress={() => Linking.openURL("mailto:support@zurielegance.co.za")}>
            <Ionicons name="mail-outline" size={18} color={WINE} />
            <Text style={styles.emailButtonText}>support@zurielegance.co.za</Text>
          </Pressable>
        )}
      </View>
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function PolicyScreen({ type, navigate }) {
  const content = {
    privacy: {
      kicker: "PRIVACY",
      title: "Privacy Policy",
      intro:
        "This Privacy Policy explains how Zuri Elegance collects, uses, stores and protects personal information in South Africa, including under the Protection of Personal Information Act, 4 of 2013 (POPIA).",
      sections: [
        {
          title: "1. Who we are",
          body:
            "Zuri Elegance is an online beauty, hair and wig store. For purposes of POPIA, Zuri Elegance acts as the responsible party when it decides why and how customer personal information is processed.",
        },
        {
          title: "2. Personal information we collect",
          body:
            "We may collect your name, email address, phone number, delivery address, city, account login details, order history, payment references, wishlist items, reward activity, beauty profile preferences, AI beauty analysis inputs, support messages and app usage information. We do not intentionally collect information from children without appropriate consent.",
        },
        {
          title: "3. Why we process your information",
          body:
            "We process personal information to create and manage accounts, process orders, arrange delivery, provide customer support, send order notifications, operate rewards, prevent fraud, improve product recommendations, provide AI Beauty Match features, comply with accounting and legal duties, and communicate important service updates.",
        },
        {
          title: "4. POPIA lawful processing",
          body:
            "We aim to process personal information lawfully, reasonably and only for specific business purposes. Our processing may be based on your consent, the need to perform a contract with you, compliance with a legal obligation, protection of legitimate business interests, or your legitimate interests as a customer.",
        },
        {
          title: "5. AI Beauty Match and special care information",
          body:
            "If you use AI Beauty Match, you may upload a selfie or beauty reference and receive styling suggestions. This information is used to generate recommendations and improve your shopping experience. Please do not upload images or information you are not comfortable sharing. We treat beauty analysis information with additional care and do not sell it.",
        },
        {
          title: "6. Sharing information",
          body:
            "We may share limited information with trusted service providers such as payment processors, delivery partners, hosting providers, email services, analytics tools and support systems. These providers may only use the information to perform services for Zuri Elegance. We may also disclose information where required by law, court order, fraud prevention, tax or regulatory obligations.",
        },
        {
          title: "7. Payments",
          body:
            "Payments are processed through secure third-party payment providers such as Paystack. Zuri Elegance does not store full card numbers, CVV codes or banking authentication details. We store payment status, payment references and order records needed for fulfilment, refunds and accounting.",
        },
        {
          title: "8. Security safeguards",
          body:
            "We use reasonable technical and organisational safeguards to protect personal information against loss, unauthorised access, misuse, alteration or disclosure. No digital platform is completely risk-free, but we take reasonable steps to keep information secure. If a security compromise materially affects your personal information, we will take appropriate steps required by POPIA, including notification where required.",
        },
        {
          title: "9. Retention",
          body:
            "We keep personal information only for as long as reasonably necessary for the purpose collected, including order fulfilment, support, legal, tax, accounting, dispute resolution, fraud prevention and legitimate business record purposes. When information is no longer needed, we will delete, de-identify or restrict it where reasonably possible.",
        },
        {
          title: "10. Your POPIA rights",
          body:
            "You may request access to your personal information, ask us to correct inaccurate information, object to certain processing, request deletion where lawful, withdraw consent where processing depends on consent, and lodge a complaint with the Information Regulator of South Africa. Some requests may be limited where we must keep records for legal, tax, delivery, fraud prevention or contractual reasons.",
        },
        {
          title: "11. Cross-border services",
          body:
            "Some technology providers used to run the app, payments, hosting, analytics or communications may process information outside South Africa. Where this happens, we take reasonable steps to use providers that offer appropriate safeguards for personal information.",
        },
        {
          title: "12. Contact",
          body:
            "For privacy questions, POPIA requests or account support, contact Zuri Elegance at support@zurielegance.co.za. Please include your name, contact details and enough information for us to identify the account or order concerned.",
        },
      ],
    },
    terms: {
      kicker: "TERMS",
      title: "Terms & Conditions",
      intro:
        "These Terms & Conditions govern your use of the Zuri Elegance mobile app, website, account features, product purchases, rewards, AI recommendations and support services.",
      sections: [
        {
          title: "1. Acceptance of terms",
          body:
            "By creating an account, browsing products, placing an order or using Zuri Elegance services, you agree to these Terms. If you do not agree, please do not use the app or place an order.",
        },
        {
          title: "2. Accounts",
          body:
            "You are responsible for keeping your login details confidential and for all activity on your account. Please provide accurate account, delivery and contact information. Zuri Elegance may suspend access where there is suspected fraud, misuse, abuse, unlawful activity or breach of these Terms.",
        },
        {
          title: "3. Products and availability",
          body:
            "Product images, colours, descriptions, lengths, textures and packaging are provided as accurately as possible, but slight variations may occur due to lighting, screens, supplier batches or styling. Products are subject to stock availability. We may correct errors, update prices, remove products or cancel unavailable items.",
        },
        {
          title: "4. Prices and payment",
          body:
            "Prices are shown in South African Rand unless stated otherwise. Orders must be paid through the payment options offered at checkout. Payment approval does not guarantee acceptance of an order if fraud checks, stock checks or pricing errors require cancellation. If an order is cancelled after payment, we will arrange an appropriate refund.",
        },
        {
          title: "5. Orders and delivery",
          body:
            "You must provide complete and correct delivery details. Delivery times are estimates and may be affected by courier delays, location, stock preparation, public holidays, incomplete details or events outside our control. Risk in the product generally passes to you when the order is delivered to the address provided.",
        },
        {
          title: "6. AI recommendations",
          body:
            "AI Beauty Match and assistant recommendations are provided for shopping guidance only. They do not replace professional medical, dermatological, haircare or cosmetology advice. You remain responsible for checking ingredients, suitability, allergies, care requirements and product details before purchase or use.",
        },
        {
          title: "7. Rewards and promotions",
          body:
            "Rewards, discounts and promotions may be subject to eligibility, expiry dates, minimum spend, stock availability and campaign rules. Rewards have no cash value unless expressly stated. Zuri Elegance may correct reward errors or withdraw abuse of reward benefits.",
        },
        {
          title: "8. Customer conduct",
          body:
            "You may not use the app for fraud, harassment, unlawful activity, attempts to access other accounts, scraping, reverse engineering, uploading harmful content, or disrupting Zuri Elegance systems. Reviews, messages and support interactions must be lawful and respectful.",
        },
        {
          title: "9. Intellectual property",
          body:
            "The Zuri Elegance name, branding, designs, product presentation, app content, text, images, logos and software elements are owned by or licensed to Zuri Elegance. You may not copy, reproduce or use them for commercial purposes without written permission.",
        },
        {
          title: "10. Limitation of liability",
          body:
            "To the extent allowed by South African law, Zuri Elegance is not liable for indirect losses, loss of profits, delays outside our control, device issues, network failures, third-party payment outages or misuse of products. Nothing in these Terms limits rights that cannot legally be limited.",
        },
        {
          title: "11. Changes to terms",
          body:
            "We may update these Terms from time to time. Updated Terms apply when published in the app or on our website. Continued use of Zuri Elegance after updates means you accept the revised Terms.",
        },
        {
          title: "12. Contact",
          body:
            "For account, order or terms-related questions, contact support@zurielegance.co.za.",
        },
      ],
    },
    shipping: {
      kicker: "SHIPPING",
      title: "Shipping Policy",
      intro:
        "This Shipping Policy explains how Zuri Elegance handles delivery, tracking and delivery-related support for online orders.",
      sections: [
        {
          title: "1. Delivery areas",
          body:
            "Zuri Elegance delivers to supported South African locations through available courier or delivery partners. Delivery availability and fees may depend on your address, order value, product size and courier coverage.",
        },
        {
          title: "2. Processing times",
          body:
            "Orders are processed after successful payment confirmation. Processing may take longer during promotions, stock checks, public holidays, supplier delays or high-volume periods.",
        },
        {
          title: "3. Delivery times and tracking",
          body:
            "Delivery times shown at checkout or in messages are estimates. Where tracking is available, we will provide a tracking number or order status update. Courier delays may occur due to weather, strikes, traffic, public holidays, remote areas or incorrect delivery details.",
        },
        {
          title: "4. Incorrect delivery details",
          body:
            "Customers must provide complete and accurate delivery information. If a parcel is delayed, returned or redelivered because of incorrect details, additional courier fees may apply.",
        },
        {
          title: "5. Delivery inspection",
          body:
            "Please inspect the parcel on delivery. If packaging appears damaged, take photos before opening and contact support@zurielegance.co.za as soon as possible with your order reference.",
        },
        {
          title: "6. Undelivered parcels",
          body:
            "If a courier cannot deliver because the customer is unavailable or the address is incomplete, the parcel may be returned. We will help arrange redelivery where possible, but additional fees may apply.",
        },
      ],
    },
    returns: {
      kicker: "RETURNS",
      title: "Returns Policy",
      intro:
        "This Returns Policy explains how Zuri Elegance handles returns, exchanges, refunds and hygiene-sensitive beauty products.",
      sections: [
        {
          title: "1. Return requests",
          body:
            "To request a return, email support@zurielegance.co.za with your order reference, product name, reason for return and clear photos where relevant. Please contact us as soon as possible after delivery so we can assess the request promptly.",
        },
        {
          title: "2. Condition of returned products",
          body:
            "Returned products must be unused, unworn, unwashed, undamaged, in original packaging and with tags, seals, accessories and protective materials intact. Products showing signs of wear, fragrance, styling, cutting, installation, staining, washing, heat treatment or tampering may not qualify.",
        },
        {
          title: "3. Hygiene-sensitive items",
          body:
            "For health and hygiene reasons, wigs, hair extensions, hair pieces, beauty tools, cosmetics, skincare and personal-care products may be excluded from return once opened, worn, installed, used or removed from hygienic packaging, unless defective or incorrectly supplied.",
        },
        {
          title: "4. Defective or incorrect items",
          body:
            "If you receive a defective, damaged or incorrect product, contact us with photos and your order reference. Once assessed, we may offer replacement, repair, exchange, store credit or refund depending on the circumstances and applicable law.",
        },
        {
          title: "5. Change-of-mind returns",
          body:
            "Where allowed, change-of-mind returns must meet our unused and original-condition requirements. Courier costs for change-of-mind returns may be for the customer's account. Original delivery fees may not be refundable unless required by law or the return is due to our error.",
        },
        {
          title: "6. Online cooling-off rights",
          body:
            "For eligible online purchases, South African electronic consumer rules may provide a cooling-off period for certain goods. This does not apply to all products and may be limited by hygiene, customisation, use, opening, damage or legal exclusions. We will assess each request fairly under applicable law.",
        },
        {
          title: "7. Refund timing",
          body:
            "Approved refunds are processed after the returned item has been received and inspected, or after the claim is otherwise approved. Refund timing may depend on the payment provider, bank processing times and fraud checks.",
        },
        {
          title: "8. Non-returnable situations",
          body:
            "We may decline returns where products are used, altered, damaged after delivery, missing packaging, returned late, purchased as final sale, affected by hygiene concerns, or where the issue results from normal wear, incorrect care, installation, handling or customer damage.",
        },
        {
          title: "9. How to contact us",
          body:
            "For returns and exchanges, email support@zurielegance.co.za. Include your order reference, contact details, reason for return and photos if the item is damaged, defective or incorrect.",
        },
      ],
    },
  }[type];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.simpleHero}>
        <Text style={styles.heroKicker}>{content.kicker}</Text>
        <Text style={styles.simpleHeroTitle}>{content.title}</Text>
        <Text style={styles.heroText}>{content.intro}</Text>
      </View>
      {content.sections.map((section) => (
        <View key={section.title} style={styles.policyCard}>
          <Text style={styles.policyTitle}>{section.title}</Text>
          <Text style={styles.policyBody}>{section.body}</Text>
        </View>
      ))}
      <View style={styles.profileCard}>
        <Text style={styles.sectionKicker}>NEED HELP?</Text>
        <Text style={styles.profileSummary}>Email support@zurielegance.co.za for help with this policy.</Text>
        <Pressable style={styles.emailButton} onPress={() => Linking.openURL("mailto:support@zurielegance.co.za")}>
          <Ionicons name="mail-outline" size={18} color={WINE} />
          <Text style={styles.emailButtonText}>support@zurielegance.co.za</Text>
        </Pressable>
      </View>
      <LuxeFooter navigate={navigate} />
    </ScrollView>
  );
}

function AssistantChat({ open, setOpen, messages, input, setInput, send }) {
  return (
    <>
      {open && (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.assistantPanel}>
          <View style={styles.assistantHeader}>
            <View>
              <Text style={styles.assistantKicker}>ZURI ASSISTANT</Text>
              <Text style={styles.assistantTitle}>Beauty chat</Text>
            </View>
            <Pressable style={styles.assistantClose} onPress={() => setOpen(false)}>
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>
          <ScrollView style={styles.assistantMessages} contentContainerStyle={styles.assistantMessageContent}>
            {messages.map((message, index) => (
              <View key={`${message.role}-${index}`} style={[styles.chatBubble, message.role === "user" && styles.chatBubbleUser]}>
                <Text style={[styles.chatText, message.role === "user" && styles.chatTextUser]}>{message.content}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.chatInputRow}>
            <TextInput
              placeholder="Ask Zuri..."
              placeholderTextColor="#8a7f82"
              style={styles.chatInput}
              value={input}
              onChangeText={setInput}
              multiline
            />
            <Pressable style={styles.sendButton} onPress={send}>
              <Ionicons name="send" size={19} color="#2b1114" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
      <Pressable style={styles.assistantFab} onPress={() => setOpen((current) => !current)}>
        <Ionicons name="chatbubbles" size={30} color={GOLD} />
      </Pressable>
    </>
  );
}

function Info({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function EmptyState({ title, text, action, onAction }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
      {action && (
        <Pressable style={styles.emptyButton} onPress={onAction}>
          <Text style={styles.emptyButtonText}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

function LuxeFooter({ navigate }) {
  const go = (target) => {
    if (target === "checkout") {
      navigate("cart");
      return;
    }
    navigate(target);
  };

  return (
    <View style={styles.footer}>
      <View>
        <Text style={styles.footerBrand}>Zuri Elegance</Text>
        <Text style={styles.footerText}>Luxury hair, beauty essentials and elegance curated for your signature look.</Text>
        <View style={styles.socialRow}>
          <SocialIcon name="facebook-f" />
          <SocialIcon name="instagram" />
          <SocialIcon name="tiktok" />
          <SocialIcon name="twitter" />
          <SocialIcon name="youtube" />
        </View>
      </View>

      <View style={styles.footerLinks}>
        <FooterColumn title="Shop" links={[["Products", "shop"], ["Wishlist", "wishlist"], ["Cart", "cart"], ["Checkout", "checkout"]]} go={go} />
        <FooterColumn title="Support" links={[["Contact", "contact"], ["Delivery", "shipping"], ["Track Order", "orders"], ["My Orders", "orders"]]} go={go} />
        <FooterColumn title="Company" links={[["About", "about"], ["Brands", "brands"], ["Profile", "profile"], ["AI Match", "beauty-match"]]} go={go} />
        <FooterColumn title="Legal" links={[["Privacy", "privacy"], ["Terms", "terms"], ["Shipping", "shipping"], ["Returns", "returns"]]} go={go} />
      </View>

      <View>
        <Text style={styles.footerColumnTitle}>PAYMENTS ACCEPTED</Text>
        <View style={styles.paymentRow}>
          <Text style={styles.paystack}>Paystack</Text>
          <PaymentIcon name="cc-visa" color="#1A1F71" />
          <PaymentIcon name="cc-mastercard" color="#EB001B" />
          <ApplePayIcon />
        </View>
      </View>

      <Text style={styles.footerBottom}>(c) 2026 Zuri Elegance. All rights reserved.</Text>
    </View>
  );
}

function SocialIcon({ name }) {
  return (
    <View style={styles.socialDot}>
      <FontAwesome5 name={name} size={14} color="#fff" />
    </View>
  );
}

function PaymentIcon({ name, color }) {
  return (
    <View style={styles.paymentIcon}>
      <FontAwesome name={name} size={30} color={color} />
    </View>
  );
}

function ApplePayIcon() {
  return (
    <View style={styles.applePayIcon}>
      <FontAwesome name="apple" size={17} color="#111" />
      <Text style={styles.applePayText}>Pay</Text>
    </View>
  );
}

function FooterColumn({ title, links, go }) {
  return (
    <View style={styles.footerColumn}>
      <Text style={styles.footerColumnTitle}>{title}</Text>
      {links.map(([label, target]) => (
        <Pressable key={label} onPress={() => go(target)} hitSlop={8} style={styles.footerLinkButton}>
          <Text style={styles.footerLink}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Field(props) {
  return <TextInput placeholderTextColor="#8a7f82" style={styles.input} autoCapitalize="none" {...props} />;
}

function PrimaryButton({ label, onPress }) {
  return (
    <Pressable style={styles.primaryButton} onPress={onPress}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function TextButton({ label, onPress }) {
  return (
    <Pressable style={styles.textButton} onPress={onPress}>
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: CREAM },
  app: { flex: 1, backgroundColor: CREAM },
  loadingBar: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    zIndex: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#fff",
    shadowColor: WINE,
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  loadingText: { color: WINE, fontWeight: "900" },
  splash: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: CREAM },
  header: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, backgroundColor: WINE, zIndex: 20 },
  headerBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingLeft: 2,
    paddingBottom: 10,
  },
  headerControlsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,.10)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.12)",
  },
  headerContent: { flex: 1, minWidth: 0, alignItems: "flex-start" },
  brandBlock: { flex: 1, minWidth: 94 },
  brandSmall: { color: GOLD, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  brandTitle: { flex: 1, color: "#fff", fontFamily: "Georgia", fontSize: 32, fontWeight: "900", marginTop: 2 },
  logoutButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,.12)",
  },
  logoutText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  topIconGroup: { marginLeft: "auto", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 7 },
  tabs: { paddingTop: 14, paddingRight: 10 },
  tab: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: { backgroundColor: GOLD },
  tabBadge: {
    position: "absolute",
    top: -3,
    right: -2,
    minWidth: 19,
    height: 19,
    borderRadius: 999,
    backgroundColor: "#f7e7ce",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: WINE,
  },
  tabBadgeText: { color: WINE, fontSize: 10, fontWeight: "900" },
  menuPanel: {
    marginTop: 10,
    padding: 12,
    borderRadius: 22,
    backgroundColor: "rgba(30,12,15,.98)",
    borderWidth: 1,
    borderColor: "rgba(163,133,96,.25)",
  },
  menuItem: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  menuItemText: { flex: 1, color: "#fff", fontWeight: "900" },
  menuItemCount: {
    minWidth: 24,
    textAlign: "center",
    color: WINE,
    backgroundColor: GOLD,
    borderRadius: 999,
    overflow: "hidden",
    fontWeight: "900",
  },
  menuLogout: { marginTop: 8, backgroundColor: WINE },
  menuLogoutText: { color: "#fff" },
  authPage: { flexGrow: 1, justifyContent: "center", padding: 18 },
  authCard: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: "#fff",
    shadowColor: WINE,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 3,
  },
  authKicker: { color: GOLD, fontWeight: "900", letterSpacing: 2, fontSize: 11 },
  authTitle: { marginTop: 8, color: WINE, fontFamily: "Georgia", fontSize: 40, fontWeight: "900" },
  authSubtitle: { marginTop: 8, marginBottom: 18, color: "#675b5e", fontWeight: "800", lineHeight: 22 },
  input: {
    minHeight: 52,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#eadfd6",
    borderRadius: 16,
    paddingHorizontal: 14,
    color: WINE,
    fontWeight: "800",
    backgroundColor: "#fffaf5",
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 17,
    backgroundColor: WINE,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryButtonText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  textButton: { paddingVertical: 14, alignItems: "center" },
  linkText: { color: WINE, fontWeight: "900" },
  page: { padding: 14, paddingBottom: 104 },
  hero: {
    borderRadius: 30,
    padding: 20,
    backgroundColor: EMERALD,
    marginBottom: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(163,133,96,.24)",
  },
  heroTextBlock: { gap: 8 },
  heroKicker: { color: GOLD, fontWeight: "900", letterSpacing: 2, fontSize: 11 },
  heroTitle: { color: "#fff", fontFamily: "Georgia", fontSize: 34, lineHeight: 38, fontWeight: "900" },
  heroText: { color: "rgba(255,255,255,.78)", fontWeight: "800", lineHeight: 22 },
  refreshButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  refreshText: { color: "#2b1114", fontWeight: "900" },
  heroBadgeStack: { marginTop: 18, flexDirection: "row", gap: 10 },
  heroBadge: {
    width: 118,
    borderRadius: 22,
    padding: 14,
    backgroundColor: "rgba(255,255,255,.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.14)",
  },
  heroBadgeNumber: { color: "#fff", fontSize: 24, fontWeight: "900" },
  heroBadgeText: { color: "#f7e7ce", fontWeight: "900", fontSize: 12 },
  heroMiniCard: { flex: 1, borderRadius: 22, padding: 14, backgroundColor: "rgba(255,255,255,.08)" },
  heroMiniKicker: { color: GOLD, fontWeight: "900", fontSize: 10, letterSpacing: 1.3 },
  heroMiniText: { marginTop: 5, color: "#fff", fontWeight: "800", lineHeight: 18 },
  analysisCard: {
    marginBottom: 16,
    padding: 28,
    borderRadius: 30,
    backgroundColor: EMERALD,
    borderWidth: 1,
    borderColor: "rgba(163,133,96,.32)",
    shadowColor: EMERALD,
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 5,
  },
  analysisHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 22 },
  analysisIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  analysisCopy: { flex: 1 },
  analysisKicker: { color: GOLD, fontWeight: "900", fontSize: 12, letterSpacing: 2 },
  analysisTitle: { marginTop: 10, color: "#fff", fontFamily: "Georgia", fontSize: 34, lineHeight: 38, fontWeight: "900" },
  analysisText: { marginTop: 10, color: "rgba(255,255,255,.78)", fontWeight: "900", lineHeight: 23, fontSize: 16 },
  analysisGrid: { marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  analysisMetric: {
    width: "48%",
    minHeight: 74,
    padding: 10,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,.10)",
  },
  metricLabel: { marginTop: 5, color: GOLD, fontSize: 10, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase" },
  metricValue: { marginTop: 3, color: "#fff", fontWeight: "900", fontSize: 12 },
  analysisTips: { marginTop: 12, gap: 8 },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  tipText: { flex: 1, color: "rgba(255,255,255,.82)", fontWeight: "800", lineHeight: 18, fontSize: 12 },
  analysisButton: {
    marginTop: 22,
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: GOLD,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  analysisButtonText: { color: "#2b1114", fontWeight: "900", fontSize: 18 },
  heroSlider: { marginBottom: 14 },
  heroSliderTrack: { gap: 12, paddingRight: 12 },
  heroSlide: {
    width: 332,
    height: 210,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: EMERALD,
    borderWidth: 1,
    borderColor: "rgba(163,133,96,.24)",
  },
  heroSlideImage: { width: "100%", height: "100%" },
  heroSlideFallback: { flex: 1, backgroundColor: EMERALD },
  heroSlideOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 18,
    backgroundColor: "rgba(43,17,20,.72)",
  },
  heroSlideKicker: { color: GOLD, fontSize: 10, fontWeight: "900", letterSpacing: 1.8 },
  heroSlideTitle: { marginTop: 4, color: "#fff", fontFamily: "Georgia", fontSize: 28, lineHeight: 31, fontWeight: "900" },
  heroSlideText: { marginTop: 4, color: "rgba(255,255,255,.78)", fontWeight: "900" },
  searchCard: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,.92)",
    borderWidth: 1,
    borderColor: "#eadfd6",
  },
  searchRow: {
    minHeight: 50,
    borderRadius: 999,
    backgroundColor: "#fffaf5",
    borderWidth: 1,
    borderColor: "#eadfd6",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, color: WINE, fontWeight: "900" },
  filterTitleRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  filterTitle: { color: WINE, fontWeight: "900", fontSize: 12 },
  filterScroll: { paddingTop: 9, paddingRight: 10 },
  filterChip: {
    marginRight: 8,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#f8f4ee",
  },
  filterChipActive: { backgroundColor: WINE },
  filterChipText: { color: WINE, fontWeight: "900", fontSize: 12 },
  filterChipTextActive: { color: "#fff" },
  sortRow: { marginTop: 10, flexDirection: "row", gap: 8, flexWrap: "wrap" },
  sortChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "#fff" },
  sortChipActive: { backgroundColor: GOLD },
  sortChipText: { color: "#75686a", fontWeight: "900", fontSize: 11 },
  sortChipTextActive: { color: "#2b1114" },
  productsTop: { marginTop: 2, marginBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  sectionKicker: { color: GOLD, fontWeight: "900", letterSpacing: 1.5, fontSize: 11 },
  sectionTitle: { marginTop: 4, color: INK, fontFamily: "Georgia", fontSize: 28, fontWeight: "900" },
  resultCount: { color: WINE, fontWeight: "900", paddingBottom: 3 },
  productGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 14 },
  productCard: {
    width: "48.5%",
    minHeight: 448,
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: EMERALD,
  },
  productImageWrap: { height: 178, backgroundColor: "#f8f4ee" },
  productImageTap: { flex: 1 },
  productImage: { width: "100%", height: "100%" },
  productImageFallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: WINE },
  productImageFallbackText: { color: GOLD, fontWeight: "900", letterSpacing: 2 },
  wishlistButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  wishlistButtonActive: { backgroundColor: WINE },
  discountBadge: {
    position: "absolute",
    top: 12,
    left: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  discountText: { color: "#2b1114", fontSize: 10, fontWeight: "900" },
  productBody: { flex: 1, padding: 12 },
  productCategory: { color: GOLD, fontWeight: "900", letterSpacing: 1.5, fontSize: 10, textTransform: "uppercase" },
  productName: { marginTop: 6, color: INK, fontSize: 18, lineHeight: 22, fontWeight: "900" },
  productDescription: { marginTop: 7, color: "#6f6264", fontWeight: "800", lineHeight: 18, minHeight: 36, fontSize: 12 },
  aiMatch: {
    marginTop: 10,
    minHeight: 64,
    borderRadius: 18,
    padding: 9,
    backgroundColor: "#f8f4ee",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  aiCircle: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  aiCircleText: { color: WINE, fontSize: 11, fontWeight: "900" },
  aiCopy: { flex: 1 },
  aiKicker: { color: GOLD, fontWeight: "900", fontSize: 10, letterSpacing: 1.2 },
  aiLabel: { color: WINE, fontWeight: "900", fontSize: 12 },
  ratingRow: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  ratingText: { color: "#6f6264", fontWeight: "900", fontSize: 12 },
  productBottom: { marginTop: "auto", paddingTop: 13, gap: 8 },
  priceStack: { minHeight: 44, justifyContent: "flex-end" },
  oldPrice: { color: "#9f9494", textDecorationLine: "line-through", fontWeight: "800", fontSize: 12 },
  price: { color: WINE, fontSize: 18, fontWeight: "900" },
  addButton: {
    minHeight: 44,
    borderRadius: 15,
    backgroundColor: WINE,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  addButtonText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  quickViewButton: {
    minHeight: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#eadfd6",
    backgroundColor: "#fffaf5",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  quickViewButtonText: { color: WINE, fontWeight: "900", fontSize: 12 },
  detailsButton: {
    minHeight: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#eadfd6",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#fffaf5",
  },
  detailsButtonText: { color: WINE, fontWeight: "900", fontSize: 12 },
  removeButton: {
    minHeight: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#eadfd6",
    backgroundColor: "#fffaf5",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  removeButtonText: { color: WINE, fontWeight: "900", fontSize: 12 },
  quickOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,10,12,.72)",
    justifyContent: "center",
    padding: 18,
  },
  quickSheet: {
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.32)",
  },
  quickClose: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,.92)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  quickImageWrap: { height: 260, backgroundColor: "#f8f4ee" },
  quickImage: { width: "100%", height: "100%" },
  quickBody: { padding: 18 },
  quickTitle: { marginTop: 6, color: INK, fontFamily: "Georgia", fontSize: 30, fontWeight: "900" },
  quickText: { marginTop: 8, color: "#6f6264", fontWeight: "800", lineHeight: 21 },
  quickPriceRow: { marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  quickActions: { marginTop: 16, flexDirection: "row", gap: 10 },
  quickWishButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#eadfd6",
    backgroundColor: "#fffaf5",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  quickWishText: { color: WINE, fontWeight: "900" },
  backButton: {
    alignSelf: "flex-start",
    minHeight: 42,
    marginBottom: 12,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eadfd6",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  backButtonText: { color: WINE, fontWeight: "900" },
  detailImageWrap: {
    height: 360,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#f8f4ee",
    borderWidth: 1,
    borderColor: "#eadfd6",
  },
  detailImage: { width: "100%", height: "100%" },
  detailDiscount: {
    position: "absolute",
    top: 16,
    left: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#fffaf5",
  },
  detailCard: {
    marginTop: 12,
    marginBottom: 12,
    padding: 18,
    borderRadius: 24,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eadfd6",
  },
  detailTitle: { marginTop: 6, color: INK, fontFamily: "Georgia", fontSize: 34, lineHeight: 38, fontWeight: "900" },
  detailDescription: { marginTop: 10, color: "#675b5e", fontWeight: "800", lineHeight: 22 },
  detailPriceRow: { marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  detailMatchPill: {
    minWidth: 104,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: "#f8f4ee",
    alignItems: "center",
  },
  detailMatchScore: { color: WINE, fontSize: 24, fontWeight: "900" },
  detailMatchLabel: { color: GOLD, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  detailSpecGrid: { marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  detailSpec: { width: "48%", minHeight: 78, padding: 12, borderRadius: 16, backgroundColor: "#fffaf5" },
  detailSpecLabel: { color: GOLD, fontSize: 10, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase" },
  detailSpecValue: { marginTop: 5, color: INK, fontWeight: "900", lineHeight: 18 },
  detailActions: { marginTop: 18, flexDirection: "row", gap: 10 },
  detailAddButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: WINE,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  detailWishButton: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#eadfd6",
    backgroundColor: "#fffaf5",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  simpleHero: { borderRadius: 28, padding: 20, backgroundColor: WINE, marginBottom: 14 },
  simpleHeroTitle: { marginTop: 8, color: "#fff", fontFamily: "Georgia", fontSize: 32, fontWeight: "900" },
  notificationHeroActions: { marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  markAllButton: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  markAllButtonText: { color: "#fff", fontWeight: "900" },
  notificationList: { gap: 10, marginBottom: 12 },
  notificationCard: {
    padding: 14,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eadfd6",
    flexDirection: "row",
    gap: 12,
  },
  notificationCardUnread: { borderColor: GOLD, backgroundColor: "#fffaf5" },
  notificationIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#f8f4ee",
    alignItems: "center",
    justifyContent: "center",
  },
  notificationCopy: { flex: 1, minWidth: 0 },
  notificationTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  notificationTitle: { flex: 1, color: INK, fontWeight: "900", fontSize: 15 },
  unreadDot: { width: 9, height: 9, borderRadius: 999, backgroundColor: GOLD },
  notificationMessage: { marginTop: 5, color: "#675b5e", fontWeight: "800", lineHeight: 19 },
  notificationMeta: { marginTop: 7, color: GOLD, fontSize: 11, fontWeight: "900" },
  pageTitle: { color: WINE, fontFamily: "Georgia", fontSize: 34, fontWeight: "900", marginBottom: 12 },
  cartItem: { padding: 15, marginBottom: 10, borderRadius: 20, backgroundColor: "#fff" },
  cartName: { color: INK, fontSize: 17, fontWeight: "900" },
  cartMeta: { marginTop: 4, color: "#75686a", fontWeight: "800" },
  qtyRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  qtyButton: { width: 40, height: 40, borderRadius: 14, backgroundColor: "#f8f4ee", alignItems: "center", justifyContent: "center" },
  qtyText: { color: WINE, fontSize: 22, fontWeight: "900" },
  qtyValue: { color: WINE, fontWeight: "900", fontSize: 18 },
  totalCard: { marginTop: 8, padding: 18, borderRadius: 24, backgroundColor: "#fff" },
  totalLabel: { color: "#75686a", fontWeight: "900" },
  totalValue: { marginTop: 4, color: WINE, fontSize: 28, fontWeight: "900" },
  totalHint: { marginTop: 6, marginBottom: 8, color: "#75686a", fontWeight: "700", lineHeight: 20 },
  paymentCard: { borderRadius: 28, padding: 22, backgroundColor: "#fff" },
  paymentText: { color: "#5f5356", fontWeight: "800", lineHeight: 22 },
  referenceBox: { marginVertical: 16, padding: 14, borderRadius: 18, backgroundColor: "#f8f4ee" },
  referenceLabel: { color: GOLD, fontWeight: "900", letterSpacing: 1.5, fontSize: 11 },
  referenceValue: { marginTop: 5, color: WINE, fontWeight: "900" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  orderCard: { marginBottom: 10, padding: 15, borderRadius: 20, backgroundColor: "#fff" },
  orderTitle: { color: WINE, fontWeight: "900", fontSize: 18 },
  orderStatus: { color: EMERALD, fontWeight: "900" },
  profileCard: { marginBottom: 12, padding: 16, borderRadius: 22, backgroundColor: "#fff" },
  profileSummary: { marginTop: 8, color: "#5f5356", fontWeight: "800", lineHeight: 21 },
  policyCard: {
    marginBottom: 10,
    padding: 15,
    borderRadius: 18,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eadfd6",
  },
  policyTitle: { color: WINE, fontWeight: "900", fontSize: 16 },
  policyBody: { marginTop: 7, color: "#5f5356", fontWeight: "700", lineHeight: 21 },
  emailButton: {
    marginTop: 14,
    minHeight: 44,
    borderRadius: 15,
    backgroundColor: "#f8f4ee",
    borderWidth: 1,
    borderColor: "#eadfd6",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emailButtonText: { color: WINE, fontWeight: "900" },
  rewardsCard: {
    marginBottom: 12,
    padding: 18,
    borderRadius: 24,
    backgroundColor: EMERALD,
    borderWidth: 1,
    borderColor: "rgba(163,133,96,.26)",
  },
  rewardsTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rewardsKicker: { color: GOLD, fontSize: 11, fontWeight: "900", letterSpacing: 1.6 },
  rewardsTitle: { marginTop: 5, color: "#fff", fontFamily: "Georgia", fontSize: 27, fontWeight: "900" },
  rewardsIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  rewardsPoints: { marginTop: 16, color: "#fff", fontSize: 42, fontWeight: "900" },
  rewardsLabel: { color: "rgba(255,255,255,.72)", fontWeight: "900" },
  rewardsProgress: {
    marginTop: 14,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,.14)",
    overflow: "hidden",
  },
  rewardsProgressFill: { height: "100%", borderRadius: 999, backgroundColor: GOLD },
  rewardsHint: { marginTop: 10, color: "rgba(255,255,255,.78)", fontWeight: "800" },
  brandGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  brandTile: {
    width: "48.5%",
    minHeight: 104,
    padding: 14,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eadfd6",
    justifyContent: "space-between",
  },
  brandTileText: { color: WINE, fontWeight: "900", fontSize: 15 },
  infoRow: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f0e8df" },
  infoLabel: { color: GOLD, fontWeight: "900", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" },
  infoValue: { marginTop: 4, color: WINE, fontWeight: "900" },
  empty: { marginTop: 8, padding: 22, borderRadius: 22, backgroundColor: "#fff" },
  emptyTitle: { color: WINE, fontSize: 22, fontWeight: "900" },
  emptyText: { marginTop: 6, color: "#75686a", fontWeight: "800", lineHeight: 21 },
  emptyButton: { marginTop: 14, alignSelf: "flex-start", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: WINE },
  emptyButtonText: { color: "#fff", fontWeight: "900" },
  assistantFab: {
    position: "absolute",
    right: 18,
    bottom: 24,
    width: 66,
    height: 66,
    borderRadius: 999,
    backgroundColor: EMERALD,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.22)",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 8,
    zIndex: 30,
  },
  assistantPanel: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 98,
    height: 430,
    zIndex: 35,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,.98)",
    borderWidth: 1,
    borderColor: "#eadfd6",
    overflow: "hidden",
  },
  assistantHeader: { padding: 16, backgroundColor: WINE, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  assistantKicker: { color: GOLD, fontWeight: "900", letterSpacing: 1.4, fontSize: 10 },
  assistantTitle: { marginTop: 2, color: "#fff", fontFamily: "Georgia", fontSize: 24, fontWeight: "900" },
  assistantClose: { width: 40, height: 40, borderRadius: 999, backgroundColor: "rgba(255,255,255,.12)", alignItems: "center", justifyContent: "center" },
  assistantMessages: { flex: 1, backgroundColor: "#fffaf5" },
  assistantMessageContent: { padding: 14, gap: 10 },
  chatBubble: { alignSelf: "flex-start", maxWidth: "86%", borderRadius: 18, padding: 12, backgroundColor: "#f4eee7" },
  chatBubbleUser: { alignSelf: "flex-end", backgroundColor: WINE },
  chatText: { color: INK, fontWeight: "800", lineHeight: 20 },
  chatTextUser: { color: "#fff" },
  chatInputRow: { flexDirection: "row", alignItems: "flex-end", gap: 9, padding: 12, backgroundColor: "#fff" },
  chatInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 92,
    borderRadius: 17,
    paddingHorizontal: 13,
    paddingVertical: 10,
    backgroundColor: "#f8f4ee",
    color: WINE,
    fontWeight: "800",
  },
  sendButton: { width: 48, height: 48, borderRadius: 16, backgroundColor: GOLD, alignItems: "center", justifyContent: "center" },
  footer: { marginTop: 16, padding: 13, borderRadius: 20, backgroundColor: WINE, borderWidth: 1, borderColor: "rgba(255,255,255,.14)" },
  footerBrand: { color: GOLD, fontFamily: "Georgia", fontSize: 22, fontWeight: "900" },
  footerText: { marginTop: 5, color: "rgba(255,255,255,.78)", fontWeight: "700", lineHeight: 17, fontSize: 11 },
  socialRow: { marginTop: 10, flexDirection: "row", gap: 7 },
  socialDot: { width: 28, height: 28, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.10)" },
  footerLinks: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", rowGap: 8 },
  footerColumn: { width: "50%", paddingRight: 8 },
  footerColumnTitle: { marginBottom: 4, color: GOLD, fontSize: 9, letterSpacing: 1.1, fontWeight: "900", textTransform: "uppercase" },
  footerLinkButton: { alignSelf: "stretch", minHeight: 28, justifyContent: "center", paddingVertical: 2 },
  footerLink: { color: "rgba(255,255,255,.82)", fontSize: 11, fontWeight: "800" },
  paymentRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  paystack: {
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: "#fff",
    backgroundColor: "#011B33",
    fontSize: 11,
    fontWeight: "900",
  },
  paymentIcon: { width: 38, height: 30, borderRadius: 7, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  applePayIcon: {
    height: 30,
    minWidth: 58,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  applePayText: { color: "#111", fontSize: 12, fontWeight: "900" },
  footerBottom: {
    marginTop: 10,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,.12)",
    textAlign: "center",
    color: "rgba(255,255,255,.68)",
    fontSize: 10,
    fontWeight: "700",
  },
});
