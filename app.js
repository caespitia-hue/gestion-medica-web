(function () {
    "use strict";

    const config = window.GESTION_SUPABASE_CONFIG;
    const clientFactory = window.supabase && window.supabase.createClient;
    const loginPanel = document.getElementById("login-panel");
    const appPanel = document.getElementById("app-panel");
    const notice = document.getElementById("notice");
    const signOutButton = document.getElementById("sign-out");
    const productsByCode = new Map();
    let client;

    const tableColumns = {
        inventario: ["codigo", "descripcion", "precio_compra", "precio_venta", "cantidad", "fecha_vencimiento"],
        compras: ["identificacion", "codigo", "descripcion", "precio_compra", "precio_venta", "fecha_vencimiento", "cantidad"],
        ventas: ["identificacion", "codigo", "descripcion", "cantidad", "precio_venta", "total", "fecha"],
        contabilidad: ["identificacion", "fecha", "descripcion", "monto", "moneda", "tasa_bcv", "tipo_pago", "metodo_pago", "tipo_servicio"]
    };

    function showNotice(message, isError) {
        notice.textContent = message;
        notice.classList.toggle("error", Boolean(isError));
        notice.classList.remove("hidden");
    }

    function clearNotice() {
        notice.textContent = "";
        notice.classList.add("hidden");
        notice.classList.remove("error");
    }

    function setBusy(form, busy) {
        const button = form.querySelector('button[type="submit"]');
        if (button) {
            button.disabled = busy;
        }
    }

    function requireConfig() {
        if (!clientFactory) {
            throw new Error("No se pudo cargar la biblioteca de Supabase. Revisa la conexión a Internet.");
        }
        if (!config || !config.url || !config.anonKey || config.anonKey.includes("PEGA_AQUI")) {
            throw new Error("Falta configurar la clave publicable de Supabase en supabase-config.js.");
        }
        client = clientFactory(config.url, config.anonKey);
    }

    function setSignedIn(signedIn) {
        loginPanel.classList.toggle("hidden", signedIn);
        appPanel.classList.toggle("hidden", !signedIn);
        signOutButton.classList.toggle("hidden", !signedIn);
    }

    function displayValue(value) {
        if (value === null || value === undefined || value === "") {
            return "";
        }
        return String(value);
    }

    function formatPrice(value) {
        const price = Number(value);
        if (value === null || value === undefined || value === "" || !Number.isFinite(price) || price < 0) {
            return "sin precio";
        }
        return "US$ " + price.toFixed(2);
    }

    function localDateISO() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        return now.getFullYear() + "-" + month + "-" + day;
    }

    function renderTable(tableName, rows) {
        const container = document.getElementById("table-" + tableName);
        container.replaceChildren();

        if (!rows.length) {
            const empty = document.createElement("p");
            empty.className = "empty";
            empty.textContent = "No hay registros para mostrar.";
            container.append(empty);
            return;
        }

        const table = document.createElement("table");
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        const columns = tableColumns[tableName];

        columns.forEach(function (column) {
            const cell = document.createElement("th");
            cell.scope = "col";
            cell.textContent = column.replace(/_/g, " ");
            headRow.append(cell);
        });
        head.append(headRow);

        const body = document.createElement("tbody");
        rows.forEach(function (row) {
            const rowElement = document.createElement("tr");
            columns.forEach(function (column) {
                const cell = document.createElement("td");
                cell.textContent = displayValue(row[column]);
                rowElement.append(cell);
            });
            body.append(rowElement);
        });

        table.append(head, body);
        container.append(table);
    }

    async function loadTable(tableName) {
        clearNotice();
        const query = client.from(tableName).select("*").limit(200);
        if (tableName === "inventario") {
            query.order("codigo", { ascending: true });
        }

        const result = await query;
        if (result.error) {
            throw result.error;
        }
        renderTable(tableName, result.data || []);

        if (tableName === "inventario") {
            productsByCode.clear();
            (result.data || []).forEach(function (product) {
                productsByCode.set(product.codigo, product);
            });
            refreshProductOptions();
        }
    }

    async function loadAllTables() {
        for (const tableName of Object.keys(tableColumns)) {
            await loadTable(tableName);
        }
    }

    function refreshProductOptions() {
        const existingSelect = document.getElementById("purchase-product");
        const saleSelect = document.getElementById("sale-product");
        existingSelect.replaceChildren();
        saleSelect.replaceChildren();

        productsByCode.forEach(function (product) {
            const purchaseOption = document.createElement("option");
            purchaseOption.value = product.codigo;
            purchaseOption.textContent = product.codigo + " - " + product.descripcion;
            existingSelect.append(purchaseOption);

            if (Number(product.cantidad) > 0) {
                const saleOption = document.createElement("option");
                saleOption.value = product.codigo;
                saleOption.textContent = product.codigo + " - " + product.descripcion
                    + " (disp.: " + product.cantidad
                    + ", precio actual: " + formatPrice(product.precio_venta) + ")";
                saleSelect.append(saleOption);
            }
        });

        document.getElementById("purchase-product-field").classList.toggle(
            "hidden",
            document.getElementById("purchase-mode").value === "new"
        );
        const isNewProduct = document.getElementById("purchase-mode").value === "new";
        document.getElementById("purchase-code-field").classList.toggle("hidden", !isNewProduct);
        document.getElementById("purchase-description-field").classList.toggle("hidden", !isNewProduct);
        document.getElementById("purchase-product").required = !isNewProduct;
        document.getElementById("purchase-code").required = isNewProduct;
        document.getElementById("purchase-description").required = isNewProduct;
        if (isNewProduct) {
            updateNewProductCode().catch(function (error) {
                showNotice("No se pudo generar el código del producto: " + error.message, true);
            });
        }

        if (!saleSelect.options.length) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No hay productos con existencias";
            saleSelect.append(option);
        }
        updateSalePrice();
    }

    async function updateNewProductCode() {
        const codeInput = document.getElementById("purchase-code");
        codeInput.value = "";
        const result = await client.rpc("proximo_codigo_producto");
        if (result.error) {
            throw result.error;
        }
        if (typeof result.data !== "string" || !/^PULM-\d{4,}$/.test(result.data)) {
            throw new Error("Supabase no devolvió un código de producto válido.");
        }
        codeInput.value = result.data;
    }

    function selectedNumber(id) {
        const value = Number(document.getElementById(id).value);
        if (!Number.isFinite(value) || value < 0) {
            throw new Error("Revisa los montos y precios: deben ser números no negativos.");
        }
        return value;
    }

    function positiveInteger(id) {
        const value = Number(document.getElementById(id).value);
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new Error("La cantidad debe ser un número entero mayor que cero.");
        }
        return value;
    }

    async function submitPurchase(event) {
        event.preventDefault();
        const form = event.currentTarget;
        setBusy(form, true);
        clearNotice();

        try {
            const mode = document.getElementById("purchase-mode").value;
            const code = mode === "new"
                ? document.getElementById("purchase-code").value.trim()
                : document.getElementById("purchase-product").value;
            const product = mode === "existing" ? productsByCode.get(code) : null;
            const description = mode === "new"
                ? document.getElementById("purchase-description").value.trim()
                : product && product.descripcion;
            if (!code || !description) {
                throw new Error(mode === "new"
                    ? "Escribe la descripción y espera a que se asigne el código automáticamente."
                    : "Selecciona un producto existente.");
            }

            let salePrice = selectedNumber("purchase-price");
            let priceNotice = "";
            if (product) {
                const currentPriceResult = await client
                    .from("inventario")
                    .select("precio_venta")
                    .eq("codigo", code)
                    .single();
                if (currentPriceResult.error) {
                    throw currentPriceResult.error;
                }
                if (!currentPriceResult.data) {
                    throw new Error("No se encontró el producto en el inventario. Actualiza la información e intenta de nuevo.");
                }

                const currentPriceValue = currentPriceResult.data.precio_venta;
                const currentPrice = Number(currentPriceValue);
                if (
                    currentPriceValue === null
                    || currentPriceValue === undefined
                    || currentPriceValue === ""
                    || !Number.isFinite(currentPrice)
                    || currentPrice < 0
                ) {
                    throw new Error("No se pudo verificar el precio de venta actual del producto.");
                }

                if (salePrice === currentPrice) {
                    window.alert(
                        "El precio de venta nuevo (US$ " + salePrice.toFixed(2)
                        + ") es igual al actual. La compra continuará sin cambiar el precio."
                    );
                    priceNotice = " El precio de venta quedó sin cambios.";
                } else if (salePrice < currentPrice) {
                    const useNewPrice = window.confirm(
                        "El precio de venta nuevo (US$ " + salePrice.toFixed(2)
                        + ") es menor que el actual (US$ " + currentPrice.toFixed(2)
                        + ").\n\nAceptar: usar el precio nuevo.\nCancelar: conservar el precio actual."
                    );
                    if (useNewPrice) {
                        priceNotice = " Se aceptó el nuevo precio de venta.";
                    } else {
                        salePrice = currentPrice;
                        document.getElementById("purchase-price").value = currentPrice.toFixed(2);
                        priceNotice = " Se conservó el precio de venta actual.";
                    }
                }
            }

            const result = await client.rpc("registrar_compra", {
                p_codigo: code,
                p_descripcion: description,
                p_precio_compra: selectedNumber("purchase-cost"),
                p_precio_venta: salePrice,
                p_fecha_vencimiento: document.getElementById("purchase-expiry").value || null,
                p_cantidad: positiveInteger("purchase-quantity"),
                p_producto_nuevo: mode === "new"
            });
            if (result.error) {
                throw result.error;
            }

            form.reset();
            document.getElementById("purchase-mode").value = "existing";
            refreshProductOptions();
            await loadAllTables();
            const successMessage = mode === "new"
                ? "Producto " + code + " creado y compra registrada."
                : "Compra registrada e inventario actualizado.";
            showNotice(successMessage + priceNotice, false);
        } catch (error) {
            showNotice("No se pudo guardar la compra: " + error.message, true);
        } finally {
            setBusy(form, false);
        }
    }

    function updateSalePrice() {
        const code = document.getElementById("sale-product").value;
        const product = productsByCode.get(code);
        const price = Number(product && product.precio_venta);
        const hasPrice = product
            && product.precio_venta !== null
            && product.precio_venta !== undefined
            && product.precio_venta !== ""
            && Number.isFinite(price)
            && price >= 0;
        document.getElementById("sale-price").value = hasPrice ? product.precio_venta : "";
        document.getElementById("sale-current-price").textContent = product
            ? "Precio actual en inventario: " + formatPrice(product.precio_venta)
            : "Precio actual en inventario: —";
        updateSaleTotal();
    }

    function updateSaleTotal() {
        const price = Number(document.getElementById("sale-price").value) || 0;
        const quantity = Number(document.getElementById("sale-quantity").value) || 0;
        document.getElementById("sale-total").textContent =
            "Total: US$ " + (price * quantity).toFixed(2);
    }

    async function submitSale(event) {
        event.preventDefault();
        const form = event.currentTarget;
        setBusy(form, true);
        clearNotice();

        try {
            const code = document.getElementById("sale-product").value;
            const product = productsByCode.get(code);
            const quantity = positiveInteger("sale-quantity");
            if (!product) {
                throw new Error("Selecciona un producto disponible.");
            }
            if (quantity > Number(product.cantidad)) {
                throw new Error("Existencias insuficientes. Disponibles: " + product.cantidad + ".");
            }

            const result = await client.rpc("registrar_venta", {
                p_codigo: code,
                p_cantidad: quantity,
                p_precio_venta: selectedNumber("sale-price"),
                p_fecha: localDateISO()
            });
            if (result.error) {
                throw result.error;
            }

            form.reset();
            await loadAllTables();
            showNotice("Venta registrada y existencias actualizadas.", false);
        } catch (error) {
            showNotice("No se pudo registrar la venta: " + error.message, true);
        } finally {
            setBusy(form, false);
        }
    }

    async function submitAccounting(event) {
        event.preventDefault();
        const form = event.currentTarget;
        setBusy(form, true);
        clearNotice();

        try {
            const description = document.getElementById("accounting-description").value.trim();
            if (!description) {
                throw new Error("Escribe una descripción.");
            }
            const result = await client.rpc("registrar_contabilidad", {
                p_fecha: document.getElementById("accounting-date").value,
                p_descripcion: description,
                p_monto: selectedNumber("accounting-amount"),
                p_moneda: document.getElementById("accounting-currency").value,
                p_tasa_bcv: selectedNumber("accounting-rate"),
                p_tipo_pago: document.getElementById("accounting-payment-type").value,
                p_metodo_pago: document.getElementById("accounting-method").value,
                p_tipo_servicio: document.getElementById("accounting-service").value
            });
            if (result.error) {
                throw result.error;
            }

            form.reset();
            document.getElementById("accounting-date").value = localDateISO();
            document.getElementById("accounting-rate").value = "0";
            await loadTable("contabilidad");
            showNotice("Registro contable guardado.", false);
        } catch (error) {
            showNotice("No se pudo guardar el registro contable: " + error.message, true);
        } finally {
            setBusy(form, false);
        }
    }

    function bindEvents() {
        document.getElementById("login-form").addEventListener("submit", async function (event) {
            event.preventDefault();
            const form = event.currentTarget;
            setBusy(form, true);
            clearNotice();
            try {
                const result = await client.auth.signInWithPassword({
                    email: document.getElementById("login-email").value.trim(),
                    password: document.getElementById("login-password").value
                });
                if (result.error) {
                    throw result.error;
                }
                setSignedIn(true);
                await loadAllTables();
            } catch (error) {
                setSignedIn(false);
                showNotice("No se pudo iniciar sesión o cargar los datos: " + error.message, true);
            } finally {
                setBusy(form, false);
            }
        });

        signOutButton.addEventListener("click", async function () {
            const result = await client.auth.signOut();
            if (result.error) {
                showNotice("No se pudo cerrar sesión: " + result.error.message, true);
                return;
            }
            setSignedIn(false);
            clearNotice();
        });

        document.querySelectorAll(".tab").forEach(function (tab) {
            tab.addEventListener("click", function () {
                document.querySelectorAll(".tab").forEach(function (item) {
                    item.classList.toggle("active", item === tab);
                });
                document.querySelectorAll(".module").forEach(function (section) {
                    section.classList.toggle("hidden", section.id !== "section-" + tab.dataset.section);
                });
            });
        });

        document.querySelectorAll(".refresh").forEach(function (button) {
            button.addEventListener("click", async function () {
                try {
                    await loadTable(button.dataset.table);
                    showNotice("Información actualizada.", false);
                } catch (error) {
                    showNotice("No se pudo actualizar la información: " + error.message, true);
                }
            });
        });

        document.getElementById("purchase-mode").addEventListener("change", refreshProductOptions);
        document.getElementById("purchase-form").addEventListener("submit", submitPurchase);
        document.getElementById("sale-form").addEventListener("submit", submitSale);
        document.getElementById("accounting-form").addEventListener("submit", submitAccounting);
        document.getElementById("sale-product").addEventListener("change", updateSalePrice);
        document.getElementById("sale-price").addEventListener("input", updateSaleTotal);
        document.getElementById("sale-quantity").addEventListener("input", updateSaleTotal);
    }

    async function start() {
        try {
            requireConfig();
            bindEvents();
            document.getElementById("accounting-date").value = localDateISO();
            const sessionResult = await client.auth.getSession();
            if (sessionResult.error) {
                throw sessionResult.error;
            }
            const signedIn = Boolean(sessionResult.data.session);
            setSignedIn(signedIn);
            if (signedIn) {
                await loadAllTables();
            }
        } catch (error) {
            setSignedIn(false);
            showNotice("La aplicación no está configurada o no pudo conectarse: " + error.message, true);
        }
    }

    start();
}());
