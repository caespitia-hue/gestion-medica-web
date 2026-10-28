(function () {
    "use strict";

    const config = window.GESTION_SUPABASE_CONFIG;
    const clientFactory = window.supabase && window.supabase.createClient;
    const loginPanel = document.getElementById("login-panel");
    const appPanel = document.getElementById("app-panel");
    const notice = document.getElementById("notice");
    const signOutButton = document.getElementById("sign-out");
    const productsByCode = new Map();
    const accountingRecords = [];
    let client;
    let pendingInventoryImport = null;
    let editingAccountingId = null;
    let accountingReportName = "control";

    const tableColumns = {
        inventario: ["codigo", "descripcion", "precio_compra", "precio_venta", "cantidad", "fecha_vencimiento"],
        compras: ["identificacion", "codigo", "descripcion", "precio_compra", "precio_venta", "fecha_vencimiento", "cantidad"],
        ventas: ["identificacion", "codigo", "descripcion", "cantidad", "precio_venta", "total", "fecha"],
        contabilidad: ["id", "fecha", "descripcion", "cantidad", "monto", "moneda", "tasa_bcv", "tipo_pago", "metodo_pago", "tipo_servicio", "monto_usd", "observaciones"]
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
        if (tableName === "contabilidad") {
            accountingRecords.length = 0;
            const pageSize = 1000;
            for (let offset = 0; ; offset += pageSize) {
                const result = await client.from(tableName)
                    .select("*")
                    .order("fecha", { ascending: false })
                    .order("id", { ascending: false })
                    .range(offset, offset + pageSize - 1);
                if (result.error) {
                    throw result.error;
                }
                accountingRecords.push.apply(accountingRecords, result.data || []);
                if (!result.data || result.data.length < pageSize) {
                    break;
                }
            }
            renderAccountingView();
            return;
        }

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

            const saleAmount = selectedNumber("sale-price") * quantity;
            prepareAccountingFromSale(product.descripcion, quantity, saleAmount);
            form.reset();
            try {
                await loadAllTables();
            } catch (error) {
                showNotice(
                    "La venta fue registrada y el inventario descontado, pero no se pudieron actualizar "
                        + "las tablas. El borrador contable quedó preparado; revisa Contabilidad y pulsa Actualizar. "
                        + error.message,
                    true
                );
                return;
            }
            showNotice(
                "Venta registrada y existencias actualizadas. Se preparó el ingreso en Contabilidad; "
                    + "completa los datos que faltan y pulsa Guardar registro.",
                false
            );
        } catch (error) {
            showNotice("No se pudo registrar la venta: " + error.message, true);
        } finally {
            setBusy(form, false);
        }
    }

    function prepareAccountingFromSale(description, quantity, amount) {
        resetAccountingForm();
        document.getElementById("accounting-description").value = description;
        document.getElementById("accounting-quantity").value = String(quantity);
        document.getElementById("accounting-amount").value = amount.toFixed(2);
        document.getElementById("accounting-currency").value = "USD";
        document.getElementById("accounting-payment-type").value = "Ingreso";
        document.getElementById("accounting-service").value = "Venta";
        updateAccountingUsdAmount();
        document.querySelector('.tab[data-section="contabilidad"]').click();
        document.getElementById("accounting-form").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function accountingDate(record) {
        return String(record.fecha || "").slice(0, 10);
    }

    function getFilteredAccountingRecords() {
        const from = document.getElementById("accounting-filter-from").value;
        const to = document.getElementById("accounting-filter-to").value;
        const search = document.getElementById("accounting-search").value.trim().toLocaleLowerCase();
        return accountingRecords.filter(function (record) {
            const date = accountingDate(record);
            if (from && date < from) {
                return false;
            }
            if (to && date > to) {
                return false;
            }
            if (search) {
                const searchable = (record.descripcion || "").toLocaleLowerCase()
                    + " " + (record.tipo_servicio || "").toLocaleLowerCase();
                if (!searchable.includes(search)) {
                    return false;
                }
            }
            return true;
        });
    }

    function formatAccountingAmount(value, currency) {
        const amount = Number(value);
        const formatted = (Number.isFinite(amount) ? amount : 0)
            .toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (currency === "USD" ? "US$ " : "Bs. ") + formatted;
    }

    function amountInRecordCurrency(record) {
        return Number(record.monto) || 0;
    }

    function amountInUSD(record) {
        const stored = Number(record.monto_usd);
        if (record.monto_usd !== null && record.monto_usd !== undefined && Number.isFinite(stored)) {
            return stored;
        }
        if (record.moneda === "USD") {
            return amountInRecordCurrency(record);
        }
        const rate = Number(record.tasa_bcv) || 0;
        return rate > 0 ? amountInRecordCurrency(record) / rate : 0;
    }

    function updateAccountingSummary(records) {
        const totals = {
            incomeBs: 0,
            expenseBs: 0,
            incomeUsd: 0,
            expenseUsd: 0
        };
        records.forEach(function (record) {
            const amount = amountInRecordCurrency(record);
            if (record.moneda === "Bs.") {
                if (record.tipo_pago === "Ingreso") {
                    totals.incomeBs += amount;
                } else {
                    totals.expenseBs += amount;
                }
            } else if (record.moneda === "USD") {
                if (record.tipo_pago === "Ingreso") {
                    totals.incomeUsd += amountInUSD(record);
                } else {
                    totals.expenseUsd += amountInUSD(record);
                }
            }
        });

        document.getElementById("accounting-income-bs").textContent = formatAccountingAmount(totals.incomeBs, "Bs.");
        document.getElementById("accounting-expense-bs").textContent = formatAccountingAmount(totals.expenseBs, "Bs.");
        document.getElementById("accounting-balance-bs").textContent =
            formatAccountingAmount(totals.incomeBs - totals.expenseBs, "Bs.");
        document.getElementById("accounting-income-usd").textContent = formatAccountingAmount(totals.incomeUsd, "USD");
        document.getElementById("accounting-expense-usd").textContent = formatAccountingAmount(totals.expenseUsd, "USD");
        document.getElementById("accounting-balance-usd").textContent =
            formatAccountingAmount(totals.incomeUsd - totals.expenseUsd, "USD");
        document.getElementById("accounting-record-count").textContent = String(records.length);
    }

    function appendTable(container, headers, rows, actionRows, footerValues) {
        container.replaceChildren();
        if (!rows.length) {
            const empty = document.createElement("p");
            empty.className = "empty";
            empty.textContent = "No hay registros para los filtros seleccionados.";
            container.append(empty);
            return;
        }

        const table = document.createElement("table");
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        headers.forEach(function (header) {
            const cell = document.createElement("th");
            cell.scope = "col";
            cell.textContent = header;
            headRow.append(cell);
        });
        if (actionRows) {
            const actionHeader = document.createElement("th");
            actionHeader.scope = "col";
            actionHeader.textContent = "Acciones";
            headRow.append(actionHeader);
        }
        head.append(headRow);

        const body = document.createElement("tbody");
        rows.forEach(function (row) {
            const rowElement = document.createElement("tr");
            row.values.forEach(function (value) {
                const cell = document.createElement("td");
                cell.textContent = displayValue(value);
                rowElement.append(cell);
            });
            if (actionRows) {
                const actionCell = document.createElement("td");
                const editButton = document.createElement("button");
                editButton.className = "button button-secondary table-action";
                editButton.type = "button";
                editButton.dataset.action = "edit";
                editButton.dataset.recordId = String(row.record.id);
                editButton.textContent = "Editar";
                const deleteButton = document.createElement("button");
                deleteButton.className = "button button-danger table-action";
                deleteButton.type = "button";
                deleteButton.dataset.action = "delete";
                deleteButton.dataset.recordId = String(row.record.id);
                deleteButton.textContent = "Eliminar";
                actionCell.append(editButton, deleteButton);
                rowElement.append(actionCell);
            }
            body.append(rowElement);
        });
        table.append(head, body);
        if (footerValues) {
            const footer = document.createElement("tfoot");
            const footerRow = document.createElement("tr");
            footerValues.forEach(function (value) {
                const cell = document.createElement("td");
                cell.textContent = displayValue(value);
                footerRow.append(cell);
            });
            footer.append(footerRow);
            table.append(footer);
        }
        container.append(table);
    }

    function renderAccountingView() {
        const records = getFilteredAccountingRecords();
        updateAccountingSummary(records);
        renderAccountingReport(accountingReportName, records);
    }

    function accountingReportValue(record, amount) {
        const currency = record.moneda === "USD" ? "USD" : "Bs.";
        return formatAccountingAmount(amount, currency);
    }

    function renderAccountingReport(reportName, sourceRecords) {
        const container = document.getElementById("table-contabilidad");
        const records = sourceRecords || getFilteredAccountingRecords();
        const reportTitle = document.getElementById("accounting-report-title");
        const reportFrom = document.getElementById("accounting-filter-from").value;
        const reportTo = document.getElementById("accounting-filter-to").value;
        let headers;
        let rows;
        let editable = false;
        let footerValues;

        if (reportName === "control") {
            reportTitle.textContent = "Control de registro";
            headers = ["ID", "Fecha", "Descripción", "Cantidad", "Monto", "Moneda", "Tasa BCV", "Método", "Tipo de pago", "Servicio", "Monto USD", "Observaciones"];
            rows = records.map(function (record) {
                return {
                    record: record,
                    values: [
                        record.id,
                        accountingDate(record),
                        record.descripcion,
                        record.cantidad,
                        accountingReportValue(record, amountInRecordCurrency(record)),
                        record.moneda,
                        record.tasa_bcv,
                        record.metodo_pago,
                        record.tipo_pago,
                        record.tipo_servicio,
                        formatAccountingAmount(amountInUSD(record), "USD"),
                        record.observaciones
                    ]
                };
            });
            editable = true;
        } else if (reportName === "daily") {
            reportTitle.textContent = "Detalle diario de caja";
            headers = [
                "Fecha", "Descripción", "Cantidad", "Ing. Bs. (Efectivo)", "Ing. Bs. (Transf.)",
                "Ing. USD (Efectivo)", "Ing. USD (Transf.)", "Egr. Bs. (Efectivo)",
                "Egr. Bs. (Transf.)", "Egr. USD (Efectivo)", "Egr. USD (Transf.)",
                "Observaciones"
            ];
            const dailyTotals = Array(8).fill(0);
            rows = records.map(function (record) {
                const isBs = record.moneda === "Bs.";
                const isIncome = record.tipo_pago === "Ingreso";
                const isCash = record.metodo_pago === "Efectivo";
                const amount = isBs ? amountInRecordCurrency(record) : amountInUSD(record);
                const values = Array(8).fill("—");
                let index;
                if (isIncome) {
                    index = isBs ? (isCash ? 0 : 1) : (isCash ? 2 : 3);
                } else {
                    index = isBs ? (isCash ? 4 : 5) : (isCash ? 6 : 7);
                }
                dailyTotals[index] += amount;
                values[index] = formatAccountingAmount(amount, isBs ? "Bs." : "USD");
                return {
                    values: [accountingDate(record), record.descripcion, record.cantidad]
                        .concat(values, [record.observaciones])
                };
            });
            footerValues = ["TOTAL", "", ""].concat(dailyTotals.map(function (amount, index) {
                return formatAccountingAmount(amount, index < 2 || (index >= 4 && index < 6) ? "Bs." : "USD");
            }), [""]);
        } else if (reportName === "monthly") {
            reportTitle.textContent = "Detalle mensual de caja";
            headers = ["Mes", "Descripción", "Cantidad", "Moneda", "Ingresos", "Egresos", "Saldo", "Observaciones"];
            rows = records.map(function (record) {
                const income = record.tipo_pago === "Ingreso";
                const amount = amountInRecordCurrency(record);
                return {
                    values: [
                        accountingDate(record).slice(0, 7),
                        record.descripcion,
                        record.cantidad,
                        record.moneda,
                        formatAccountingAmount(income ? amount : 0, record.moneda),
                        formatAccountingAmount(income ? 0 : amount, record.moneda),
                        formatAccountingAmount(income ? amount : -amount, record.moneda),
                        record.observaciones
                    ]
                };
            });
        } else {
            reportTitle.textContent = "Resumen mensual de caja";
            headers = ["Mes", "Descripción", "Cantidad", "Ingreso Bs.", "Egreso Bs.", "Ingreso USD", "Egreso USD", "Observaciones"];
            rows = records.map(function (record) {
                const isIncome = record.tipo_pago === "Ingreso";
                const isBs = record.moneda === "Bs.";
                const amount = isBs ? amountInRecordCurrency(record) : amountInUSD(record);
                return {
                    values: [
                        accountingDate(record).slice(0, 7),
                        record.descripcion,
                        record.cantidad,
                        formatAccountingAmount(isBs && isIncome ? amount : 0, "Bs."),
                        formatAccountingAmount(isBs && !isIncome ? amount : 0, "Bs."),
                        formatAccountingAmount(!isBs && isIncome ? amount : 0, "USD"),
                        formatAccountingAmount(!isBs && !isIncome ? amount : 0, "USD"),
                        record.observaciones
                    ]
                };
            });
        }

        if (reportFrom || reportTo) {
            const period = reportFrom && reportTo
                ? " (" + reportFrom + " a " + reportTo + ")"
                : " (" + (reportFrom ? "desde " + reportFrom : "hasta " + reportTo) + ")";
            reportTitle.textContent += period;
        }
        appendTable(container, headers, rows, editable, footerValues);
    }

    function updateAccountingUsdAmount() {
        const amount = Number(document.getElementById("accounting-amount").value);
        const rate = Number(document.getElementById("accounting-rate").value);
        const currency = document.getElementById("accounting-currency").value;
        let usdAmount = 0;
        if (Number.isFinite(amount) && amount >= 0) {
            if (currency === "USD") {
                usdAmount = amount;
            } else if (Number.isFinite(rate) && rate > 0) {
                usdAmount = amount / rate;
            }
        }
        document.getElementById("accounting-usd-amount").value = usdAmount.toFixed(2);
    }

    function resetAccountingForm() {
        editingAccountingId = null;
        const form = document.getElementById("accounting-form");
        form.reset();
        document.getElementById("accounting-date").value = localDateISO();
        document.getElementById("accounting-currency").value = "Bs.";
        document.getElementById("accounting-payment-type").value = "Ingreso";
        document.getElementById("accounting-method").value = "Efectivo";
        document.getElementById("accounting-service").value = "Venta";
        document.getElementById("accounting-rate").value = "0";
        document.getElementById("accounting-save").textContent = "Guardar registro";
        updateAccountingUsdAmount();
    }

    function editAccountingRecord(recordId) {
        const record = accountingRecords.find(function (item) {
            return String(item.id) === recordId;
        });
        if (!record) {
            showNotice("No se encontró el registro seleccionado. Actualiza la información.", true);
            return;
        }
        editingAccountingId = String(record.id);
        document.getElementById("accounting-date").value = accountingDate(record);
        document.getElementById("accounting-description").value = record.descripcion || "";
        document.getElementById("accounting-quantity").value = record.cantidad === null || record.cantidad === undefined
            ? ""
            : record.cantidad;
        document.getElementById("accounting-amount").value = record.monto;
        document.getElementById("accounting-currency").value = record.moneda;
        document.getElementById("accounting-rate").value = record.tasa_bcv || 0;
        document.getElementById("accounting-payment-type").value = record.tipo_pago;
        document.getElementById("accounting-method").value = record.metodo_pago;
        document.getElementById("accounting-service").value = record.tipo_servicio;
        document.getElementById("accounting-observations").value = record.observaciones || "";
        document.getElementById("accounting-save").textContent = "Actualizar registro";
        updateAccountingUsdAmount();
        document.getElementById("accounting-form").scrollIntoView({ behavior: "smooth", block: "start" });
        showNotice("Editando el registro " + recordId + ". Guarda los cambios o limpia el formulario para cancelar.", false);
    }

    async function deleteAccountingRecord(recordId) {
        const record = accountingRecords.find(function (item) {
            return String(item.id) === recordId;
        });
        if (!record) {
            showNotice("No se encontró el registro seleccionado. Actualiza la información.", true);
            return;
        }
        if (!window.confirm(
            "¿Eliminar el registro " + recordId + "?\n"
            + record.fecha + " — " + record.descripcion + "\n\nEsta acción no se puede deshacer."
        )) {
            return;
        }
        const result = await client.rpc("eliminar_registro_contable", {
            p_identificacion: recordId
        });
        if (result.error) {
            throw result.error;
        }
        await loadTable("contabilidad");
        showNotice("Registro " + recordId + " eliminado.", false);
    }

    function exportAccountingCsv() {
        const records = getFilteredAccountingRecords();
        const columns = [
            ["id", "ID"], ["fecha", "Fecha"], ["descripcion", "Descripción"], ["cantidad", "Cantidad"],
            ["monto", "Monto"], ["moneda", "Moneda"], ["tasa_bcv", "Tasa BCV"],
            ["metodo_pago", "Método"], ["tipo_pago", "Tipo Pago"], ["tipo_servicio", "Servicio"],
            ["monto_usd", "Monto USD"], ["observaciones", "Observaciones"]
        ];
        const lines = [
            "sep=;\r\n" + columns.map(function (column) { return csvField(column[1]); }).join(";")
        ];
        records.forEach(function (record) {
            lines.push(columns.map(function (column) {
                return csvField(column[0] === "fecha" ? accountingDate(record) : record[column[0]]);
            }).join(";"));
        });
        const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "contabilidad-" + localDateISO() + ".csv";
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showNotice("Reporte contable exportado: " + records.length + " registros.", false);
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
            const result = await client.rpc("guardar_registro_contable", {
                p_identificacion: editingAccountingId,
                p_fecha: document.getElementById("accounting-date").value,
                p_descripcion: description,
                p_cantidad: document.getElementById("accounting-quantity").value
                    ? positiveInteger("accounting-quantity")
                    : null,
                p_monto: selectedNumber("accounting-amount"),
                p_moneda: document.getElementById("accounting-currency").value,
                p_tasa_bcv: selectedNumber("accounting-rate"),
                p_tipo_pago: document.getElementById("accounting-payment-type").value,
                p_metodo_pago: document.getElementById("accounting-method").value,
                p_tipo_servicio: document.getElementById("accounting-service").value,
                p_observaciones: document.getElementById("accounting-observations").value.trim()
            });
            if (result.error) {
                throw result.error;
            }

            const wasEditing = editingAccountingId !== null;
            resetAccountingForm();
            try {
                await loadAllTables();
            } catch (error) {
                showNotice(
                    "El registro se guardó, pero no se pudo actualizar la pantalla. "
                        + "Pulsa Actualizar para volver a cargarlo: " + error.message,
                    true
                );
                return;
            }
            showNotice(wasEditing
                ? "Registro " + result.data + " actualizado correctamente."
                : "Registro " + result.data + " guardado correctamente.", false);
        } catch (error) {
            showNotice("No se pudo guardar el registro contable: " + error.message, true);
        } finally {
            setBusy(form, false);
        }
    }

    function parseCsv(text) {
        const source = text.replace(/^\uFEFF/, "");
        const firstLine = source.split(/\r?\n/, 1)[0];
        const delimiter = firstLine.trim().toLowerCase().startsWith("sep=")
            ? firstLine.trim().slice(4, 5)
            : (firstLine.split(";").length > firstLine.split(",").length ? ";" : ",");
        const rows = [];
        let row = [];
        let field = "";
        let quoted = false;
        let start = firstLine.trim().toLowerCase().startsWith("sep=")
            ? source.indexOf("\n") + 1
            : 0;

        for (let index = start; index < source.length; index += 1) {
            const character = source[index];
            if (quoted) {
                if (character === '"' && source[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else if (character === '"') {
                    quoted = false;
                } else {
                    field += character;
                }
            } else if (character === '"' && field.length === 0) {
                quoted = true;
            } else if (character === delimiter) {
                row.push(field);
                field = "";
            } else if (character === "\n" || character === "\r") {
                if (character === "\r" && source[index + 1] === "\n") {
                    index += 1;
                }
                row.push(field);
                if (row.some(function (value) { return value.trim() !== ""; })) {
                    rows.push(row);
                }
                row = [];
                field = "";
            } else {
                field += character;
            }
        }

        if (quoted) {
            throw new Error("El archivo CSV tiene comillas sin cerrar.");
        }
        row.push(field);
        if (row.some(function (value) { return value.trim() !== ""; })) {
            rows.push(row);
        }
        if (rows.length < 2) {
            throw new Error("El CSV debe tener encabezados y al menos un producto.");
        }
        return rows;
    }

    function normalizeCsvHeader(value) {
        return value.trim().toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, "");
    }

    function parseCsvNumber(value, label, lineNumber) {
        let normalized = value.trim().replace(/\s/g, "");
        if (normalized.includes(",") && normalized.includes(".")) {
            if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
                normalized = normalized.replace(/\./g, "").replace(",", ".");
            } else {
                normalized = normalized.replace(/,/g, "");
            }
        } else if (normalized.includes(",")) {
            normalized = normalized.replace(",", ".");
        }

        const number = Number(normalized);
        if (!Number.isFinite(number) || number < 0) {
            throw new Error("La columna " + label + " debe ser un número igual o mayor que cero (fila " + lineNumber + ").");
        }
        return number;
    }

    function normalizeImportedDate(value, lineNumber) {
        const date = value.trim();
        if (!date) {
            return null;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return date;
        }

        const localized = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (localized) {
            const day = Number(localized[1]);
            const month = Number(localized[2]);
            const year = Number(localized[3]);
            const parsed = new Date(Date.UTC(year, month - 1, day));
            if (
                parsed.getUTCFullYear() === year
                && parsed.getUTCMonth() === month - 1
                && parsed.getUTCDate() === day
            ) {
                return year + "-" + String(month).padStart(2, "0")
                    + "-" + String(day).padStart(2, "0");
            }
        }
        throw new Error("La fecha de vencimiento debe estar en formato AAAA-MM-DD o DD/MM/AAAA (fila " + lineNumber + ").");
    }

    function parseInventoryCsv(text) {
        const rows = parseCsv(text);
        const headers = rows[0].map(normalizeCsvHeader);
        const columnAliases = {
            codigo: ["codigo", "codigoproducto"],
            descripcion: ["descripcion", "producto"],
            precio_compra: ["preciocompra"],
            precio_venta: ["precioventa"],
            cantidad: ["cantidad", "existencia", "existencias"],
            fecha_vencimiento: ["fechavencimiento", "vencimiento"]
        };
        const indexes = {};
        Object.keys(columnAliases).forEach(function (column) {
            indexes[column] = headers.findIndex(function (header) {
                return columnAliases[column].includes(header);
            });
        });
        const requiredColumns = ["codigo", "descripcion", "precio_compra", "precio_venta", "cantidad"];
        const missing = requiredColumns.filter(function (column) { return indexes[column] < 0; });
        if (missing.length) {
            throw new Error("Faltan columnas requeridas: " + missing.join(", ")
                + ". Exporta primero el inventario para obtener el formato correcto.");
        }

        const seenCodes = new Set();
        const products = rows.slice(1).map(function (values, index) {
            const lineNumber = index + 2;
            const get = function (column) {
                const columnIndex = indexes[column];
                return columnIndex < 0 ? "" : (values[columnIndex] || "").trim();
            };
            const code = get("codigo");
            const description = get("descripcion");
            if (!description) {
                throw new Error("La descripción es obligatoria (fila " + lineNumber + ").");
            }
            if (code && seenCodes.has(code)) {
                throw new Error("El código " + code + " aparece más de una vez (fila " + lineNumber + ").");
            }
            if (code) {
                seenCodes.add(code);
            }

            const quantity = parseCsvNumber(get("cantidad"), "cantidad", lineNumber);
            if (!Number.isSafeInteger(quantity) || quantity > 2147483647) {
                throw new Error("La cantidad debe ser un número entero (fila " + lineNumber + ").");
            }
            return {
                codigo: code,
                descripcion: description,
                precio_compra: parseCsvNumber(get("precio_compra"), "precio_compra", lineNumber),
                precio_venta: parseCsvNumber(get("precio_venta"), "precio_venta", lineNumber),
                cantidad: quantity,
                fecha_vencimiento: normalizeImportedDate(get("fecha_vencimiento"), lineNumber)
            };
        });

        if (!products.length || products.length > 500) {
            throw new Error("El archivo debe contener entre 1 y 500 productos por importación.");
        }
        return products;
    }

    function csvField(value) {
        const text = value === null || value === undefined ? "" : String(value);
        return '"' + text.replace(/"/g, '""') + '"';
    }

    async function exportInventory() {
        const products = [];
        const pageSize = 1000;
        for (let offset = 0; ; offset += pageSize) {
            const result = await client.from("inventario")
                .select("codigo,descripcion,precio_compra,precio_venta,cantidad,fecha_vencimiento")
                .order("codigo", { ascending: true })
                .range(offset, offset + pageSize - 1);
            if (result.error) {
                throw result.error;
            }
            products.push.apply(products, result.data || []);
            if (!result.data || result.data.length < pageSize) {
                break;
            }
        }

        const headers = ["codigo", "descripcion", "precio_compra", "precio_venta", "cantidad", "fecha_vencimiento"];
        const lines = ["sep=;" + "\r\n" + headers.map(csvField).join(";")];
        products.forEach(function (product) {
            lines.push(headers.map(function (column) {
                return csvField(product[column]);
            }).join(";"));
        });

        const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "inventario-" + localDateISO() + ".csv";
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showNotice("Inventario exportado: " + products.length + " productos.", false);
    }

    async function findExistingInventory(products) {
        const codes = Array.from(new Set(products
            .map(function (product) { return product.codigo; })
            .filter(Boolean)));
        const existing = new Map();

        for (let offset = 0; offset < codes.length; offset += 100) {
            const result = await client.from("inventario")
                .select("codigo,cantidad")
                .in("codigo", codes.slice(offset, offset + 100));
            if (result.error) {
                throw result.error;
            }
            (result.data || []).forEach(function (product) {
                existing.set(product.codigo, product);
            });
        }
        return existing;
    }

    async function importInventory(event) {
        const input = event.currentTarget;
        const file = input.files && input.files[0];
        if (!file) {
            return;
        }

        const preview = document.getElementById("inventory-import-preview");
        preview.classList.add("hidden");
        pendingInventoryImport = null;
        clearNotice();
        try {
            if (!file.name.toLowerCase().endsWith(".csv")) {
                throw new Error("Selecciona un archivo CSV exportado o guardado desde Excel.");
            }
            if (file.size > 5 * 1024 * 1024) {
                throw new Error("El archivo supera el límite de 5 MB.");
            }
            const products = parseInventoryCsv(await file.text());
            const existingProducts = await findExistingInventory(products);
            const existingCount = products.filter(function (product) {
                return product.codigo && existingProducts.has(product.codigo);
            }).length;
            const newCount = products.length - existingCount;
            const codesToGenerate = products.filter(function (product) { return !product.codigo; }).length;
            const message = "Vista previa: " + products.length + " productos; "
                + existingCount + " existentes (se reemplazarán sus datos y cantidades); "
                + newCount + " nuevos; " + codesToGenerate + " recibirán código automático."
                + " No se crearán registros de compras ni contabilidad.";
            document.getElementById("inventory-import-summary").textContent = message;

            const items = document.getElementById("inventory-import-items");
            items.replaceChildren();
            products.slice(0, 10).forEach(function (product) {
                const current = product.codigo ? existingProducts.get(product.codigo) : null;
                const item = document.createElement("li");
                item.textContent = (product.codigo || "Código automático")
                    + " — " + product.descripcion
                    + (current ? ": cantidad " + current.cantidad + " → " + product.cantidad : ": nueva cantidad " + product.cantidad);
                items.append(item);
            });
            document.getElementById("inventory-import-more").textContent = products.length > 10
                ? "Se muestran 10 de " + products.length + " productos."
                : "";
            pendingInventoryImport = products;
            preview.classList.remove("hidden");
            showNotice("Revisa la vista previa y confirma o cancela la importación.", false);
        } catch (error) {
            showNotice("No se pudo preparar la importación: " + error.message, true);
        } finally {
            input.value = "";
        }
    }

    async function confirmInventoryImport() {
        if (!pendingInventoryImport) {
            showNotice("Selecciona y revisa un archivo antes de confirmar.", true);
            return;
        }

        const button = document.getElementById("confirm-inventory-import");
        button.disabled = true;
        clearNotice();
        try {
            const result = await client.rpc("importar_inventario", {
                p_productos: pendingInventoryImport
            });
            if (result.error) {
                throw result.error;
            }
            if (
                !result.data
                || !Number.isInteger(result.data.actualizados)
                || !Number.isInteger(result.data.nuevos)
            ) {
                throw new Error("Supabase no devolvió el resumen esperado de la importación.");
            }
            await loadTable("inventario");
            document.getElementById("inventory-import-preview").classList.add("hidden");
            pendingInventoryImport = null;
            showNotice(
                "Importación completada: " + result.data.actualizados + " actualizados y "
                    + result.data.nuevos + " nuevos.",
                false
            );
        } catch (error) {
            showNotice("No se pudo importar el inventario: " + error.message, true);
        } finally {
            button.disabled = false;
        }
    }

    function cancelInventoryImport() {
        pendingInventoryImport = null;
        document.getElementById("inventory-import-preview").classList.add("hidden");
        showNotice("Importación cancelada. No se modificó el inventario.", false);
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
        document.getElementById("accounting-reset").addEventListener("click", function () {
            resetAccountingForm();
            clearNotice();
        });
        document.getElementById("accounting-amount").addEventListener("input", updateAccountingUsdAmount);
        document.getElementById("accounting-currency").addEventListener("change", updateAccountingUsdAmount);
        document.getElementById("accounting-rate").addEventListener("input", updateAccountingUsdAmount);
        function renderAccountingIfValid() {
            const from = document.getElementById("accounting-filter-from").value;
            const to = document.getElementById("accounting-filter-to").value;
            if (from && to && from > to) {
                showNotice("La fecha inicial no puede ser posterior a la fecha final.", true);
                return false;
            }
            renderAccountingView();
            clearNotice();
            return true;
        }
        document.getElementById("accounting-apply-filter").addEventListener("click", function () {
            renderAccountingIfValid();
        });
        document.getElementById("accounting-show-all").addEventListener("click", function () {
            document.getElementById("accounting-filter-from").value = "";
            document.getElementById("accounting-filter-to").value = "";
            document.getElementById("accounting-search").value = "";
            accountingReportName = "control";
            renderAccountingView();
            clearNotice();
        });
        document.getElementById("accounting-search-button").addEventListener("click", function () {
            renderAccountingIfValid();
        });
        document.getElementById("accounting-search").addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                renderAccountingIfValid();
            }
        });
        document.getElementById("accounting-clear-search").addEventListener("click", function () {
            document.getElementById("accounting-search").value = "";
            renderAccountingIfValid();
        });
        document.getElementById("accounting-export").addEventListener("click", function () {
            if (!renderAccountingIfValid()) {
                return;
            }
            try {
                exportAccountingCsv();
            } catch (error) {
                showNotice("No se pudo exportar el reporte contable: " + error.message, true);
            }
        });
        document.querySelectorAll(".accounting-report").forEach(function (button) {
            button.addEventListener("click", function () {
                accountingReportName = button.dataset.report;
                if (!renderAccountingIfValid()) {
                    return;
                }
            });
        });
        document.getElementById("table-contabilidad").addEventListener("click", async function (event) {
            const button = event.target.closest("button[data-action]");
            if (!button) {
                return;
            }
            const recordId = button.dataset.recordId;
            if (button.dataset.action === "edit") {
                editAccountingRecord(recordId);
            } else if (button.dataset.action === "delete") {
                button.disabled = true;
                try {
                    await deleteAccountingRecord(recordId);
                } catch (error) {
                    showNotice("No se pudo eliminar el registro contable: " + error.message, true);
                } finally {
                    button.disabled = false;
                }
            }
        });
        document.getElementById("sale-product").addEventListener("change", updateSalePrice);
        document.getElementById("sale-price").addEventListener("input", updateSaleTotal);
        document.getElementById("sale-quantity").addEventListener("input", updateSaleTotal);
        document.getElementById("export-inventory").addEventListener("click", async function () {
            try {
                await exportInventory();
            } catch (error) {
                showNotice("No se pudo exportar el inventario: " + error.message, true);
            }
        });
        document.getElementById("import-inventory").addEventListener("change", importInventory);
        document.getElementById("confirm-inventory-import").addEventListener("click", confirmInventoryImport);
        document.getElementById("cancel-inventory-import").addEventListener("click", cancelInventoryImport);
    }

    async function start() {
        try {
            requireConfig();
            bindEvents();
            document.getElementById("accounting-date").value = localDateISO();
            updateAccountingUsdAmount();
            renderAccountingView();
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
