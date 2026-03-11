const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));

const PORT = process.env.PORT || 3000;
const MAIL_FROM = process.env.BREVO_SENDER || process.env.BREVO_USER;

// ==============================
// CONFIG SMTP
// ==============================

const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 2525,
    secure: false,
    auth: {
        user: process.env.BREVO_USER,
        pass: process.env.BREVO_PASS
    },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    logger: true,
    debug: true
});

// ==============================
// HELPERS
// ==============================

function formatMXN(n) {
    return (typeof n === "number" && !isNaN(n))
        ? n.toLocaleString("es-MX", { style: "currency", currency: "MXN" })
        : "$0.00";
}

function extraerBase64(base64String) {
    if (!base64String) return null;
    return base64String.split(",")[1] || base64String;
}

function validarPayloadBasico(emailDestino, ticketData) {
    return !!(emailDestino && ticketData && ticketData.cliente && ticketData.codigoTicket);
}

function crearAdjuntoInline(base64, filename, cid) {
    const content = extraerBase64(base64);
    if (!content) return null;

    return {
        filename,
        content,
        encoding: "base64",
        cid
    };
}

function crearMailOptions({ to, subject, html, attachments = [] }) {
    return {
        from: {
            name: "NAVIX - Sistema de Tickets",
            address: MAIL_FROM
        },
        to,
        subject,
        html,
        attachments
    };
}

async function enviarCorreo({ to, subject, html, attachments = [] }) {
    const mailOptions = crearMailOptions({ to, subject, html, attachments });

    console.log("==============================================");
    console.log("Intentando enviar correo");
    console.log("FROM:", mailOptions.from.address);
    console.log("TO:", to);
    console.log("SUBJECT:", subject);
    console.log("ATTACHMENTS:", attachments.length);
    console.log("==============================================");

    const info = await transporter.sendMail(mailOptions);

    console.log("=========== RESULTADO SMTP ===========");
    console.log("messageId:", info.messageId);
    console.log("accepted:", info.accepted);
    console.log("rejected:", info.rejected);
    console.log("pending:", info.pending);
    console.log("response:", info.response);
    console.log("======================================");

    return info;
}

// ==============================
// HTMLS
// ==============================

function generarHTMLTicket(data) {
    let productosHTML = "";
    let subtotalProductos = 0;

    data.proveedores.forEach(p => {
        subtotalProductos += p.subtotal;

        const productosListaHTML = p.productos.map(x => `
            <div style="margin-left:20px;margin-bottom:8px;">
                • <strong>${x.nombre}</strong><br>
                <span style="margin-left:25px;font-size:13px;color:#666;">
                    Temperatura: <span style="color:#995E8E;font-weight:bold;">${x.temperatura}</span><br>
                </span>
                <span style="margin-left:25px;font-size:13px;">
                    Precio por caja: ${formatMXN(x.precioPorCaja)} × ${x.cajas} cajas = <strong>${formatMXN(x.total)}</strong>
                </span>
            </div>
        `).join("");

        productosHTML += `
            <div style="background:#faf5ff;padding:15px;border-radius:10px;border-left:4px solid #995E8E;margin-bottom:15px;">
                <div style="font-size:15px;font-weight:bold;color:#995E8E;margin-bottom:8px;">
                    ${p.proveedor}
                </div>
                <div style="font-size:13px;color:#555;margin-bottom:5px;">
                    <strong>Ruta:</strong> ${p.ruta}
                </div>
                <div style="font-size:13px;color:#555;margin-bottom:12px;">
                    <strong>Kilómetros:</strong> ${p.kms} km
                </div>
                <div style="background:#fff5fb;padding:12px;border-radius:8px;margin-top:10px;">
                    <strong style="color:#333;">Productos:</strong><br>
                    ${productosListaHTML}
                </div>
                <div style="text-align:right;font-weight:bold;margin-top:12px;font-size:14px;color:#333;">
                    Subtotal proveedor: ${formatMXN(p.subtotal)}
                </div>
            </div>
        `;
    });

    const costosFijosHTML = data.costoRuta ? `
        <div style="background:#f5faff;padding:15px;border-radius:10px;border-left:4px solid #F08BB0;margin-bottom:15px;">
            <div style="font-size:15px;font-weight:bold;color:#995E8E;margin-bottom:10px;">
                💰 COSTOS FIJOS DE RUTA BASE (${data.totalKm})
            </div>
            <div style="font-size:14px;margin-bottom:8px;">
                <strong>Costo Base (Transporte):</strong> ${formatMXN(data.costoRutaAcumulado)}
            </div>
            <div style="font-size:13px;color:#555;line-height:1.8;">
                • Casetas: ${formatMXN(data.costoRuta.casetas)}<br>
                • Combustible: ${formatMXN(data.costoRuta.combustible)}<br>
                • Chofer: ${formatMXN(data.costoRuta.chofer)}<br>
                • Mantenimiento: ${formatMXN(data.costoRuta.mantenimiento)}<br>
                • Desgaste de Llantas: ${formatMXN(data.costoRuta.llantas)}<br>
                • Depreciación: ${formatMXN(data.costoRuta.depreciacion)}
            </div>
            <div style="margin-top:10px;font-size:13px;font-weight:bold;color:#333;">
                Costo Promedio por Km: ${formatMXN(data.costoRuta.costoKm)}
            </div>
        </div>
    ` : "";

    return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Ticket NAVIX</title>
        </head>
        <body style="margin:0;padding:20px;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f5f5f5;">
            <div style="max-width:650px;margin:0 auto;background:white;padding:30px;border-radius:16px;border-left:8px solid #995E8E;">
                <h2 style="color:#8b4e7f;text-align:center;margin-top:0;font-size:24px;">
                    🎫 Ticket de Registro — NAVIX
                </h2>

                ${data.fotoCliente ? `
                <div style="text-align:center;margin:20px 0;">
                    <img src="cid:fotoCliente" alt="Foto del Cliente"
                         style="width:130px;height:130px;border-radius:12px;object-fit:cover;">
                </div>
                ` : ""}

                <div style="background:#faf5ff;padding:12px 14px;border-radius:10px;border-left:4px solid #995E8E;margin-bottom:14px;font-size:13px;">
                    <strong>Fecha y Hora:</strong> ${new Date().toLocaleString("es-MX")}<br>
                    <strong>Proveedores:</strong> ${data.totalProveedores}<br>
                    <strong>Productos:</strong> ${data.totalProductos}<br>
                    <strong>Kilómetros Totales:</strong> ${data.totalKm}
                </div>

                ${costosFijosHTML}

                <div style="background:#faf5ff;padding:12px 14px;border-radius:10px;border-left:4px solid #995E8E;margin-bottom:14px;font-size:13px;">
                    <strong>Nombre:</strong> ${data.cliente.nombre}<br>
                    <strong>Teléfono:</strong> ${data.cliente.telefono}<br>
                    <strong>Email:</strong> ${data.cliente.email}<br>
                    <strong>Dirección:</strong> ${data.cliente.direccion}<br>
                    <strong>Notas:</strong> ${data.cliente.notas || "Ninguna"}
                </div>

                ${productosHTML}

                <div style="background:#fff5fb;padding:12px;border-radius:10px;border-left:4px solid #F08BB0;margin-top:15px;">
                    <div style="text-align:right;font-size:14px;margin:5px 0;">
                        Subtotal Productos: ${formatMXN(subtotalProductos)}
                    </div>
                    <div style="text-align:right;font-size:14px;margin:5px 0;">
                        Costo Fijo de Ruta: ${formatMXN(data.costoRutaAcumulado || 0)}
                    </div>
                </div>

                <div style="padding:14px;background:#fff9f9;border-radius:10px;border-left:4px solid #995E8E;font-weight:900;font-size:18px;text-align:right;margin-top:15px;">
                    💰TOTAL GENERAL: ${formatMXN(data.totalGeneral)}
                </div>

                <div style="background:#f0f0f0;padding:15px;border-radius:10px;border-left:4px solid #995E8E;text-align:center;margin-top:15px;">
                    <div style="font-weight:bold;font-size:14px;color:#6b3570;margin-bottom:5px;">
                        📋 CÓDIGO DE TICKET
                    </div>
                    <div style="font-size:20px;font-weight:bold;color:#995E8E;letter-spacing:3px;">
                        ${data.codigoTicket}
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
}

function generarHTMLEnCamino(data) {
    return `
        <html><body style="font-family:Segoe UI,sans-serif;padding:20px;">
            <h2>📦 Su Pedido Está en Camino</h2>
            <p>Hola <strong>${data.cliente.nombre}</strong>, su pedido con código <strong>${data.codigoTicket}</strong> va en camino.</p>
            <p>Total del pedido: <strong>${formatMXN(data.totalGeneral)}</strong></p>
        </body></html>
    `;
}

function generarHTMLEntregado(data, incluirFotoEntrega = false) {
    return `
        <html><body style="font-family:Segoe UI,sans-serif;padding:20px;">
            <h2>✅ ¡Pedido Entregado con Éxito!</h2>
            ${incluirFotoEntrega ? `
                <div style="margin:20px 0;">
                    <img src="cid:fotoEntrega" alt="Foto de Entrega" style="width:200px;border-radius:12px;">
                </div>
            ` : ""}
            <p>Hola <strong>${data.cliente.nombre}</strong>, su pedido <strong>${data.codigoTicket}</strong> fue entregado.</p>
            <p>Total del pedido: <strong>${formatMXN(data.totalGeneral)}</strong></p>
        </body></html>
    `;
}

// ==============================
// ENDPOINTS
// ==============================

app.get("/", (req, res) => {
    res.json({
        ok: true,
        message: "Servidor NAVIX corriendo correctamente",
        from: MAIL_FROM
    });
});

app.get("/api/debug-smtp", async (req, res) => {
    try {
        await transporter.verify();
        res.json({
            ok: true,
            message: "SMTP verificado correctamente",
            from: MAIL_FROM
        });
    } catch (error) {
        console.error("Fallo verify:", error);
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

app.post("/api/enviar-ticket", async (req, res) => {
    try {
        const { emailDestino, ticketData } = req.body;

        if (!validarPayloadBasico(emailDestino, ticketData)) {
            return res.status(400).json({ success: false, error: "Faltan datos requeridos" });
        }

        const attachments = [];
        const adjuntoFotoCliente = crearAdjuntoInline(ticketData.fotoCliente, "foto-cliente.jpg", "fotoCliente");
        if (adjuntoFotoCliente) attachments.push(adjuntoFotoCliente);

        const info = await enviarCorreo({
            to: emailDestino,
            subject: `🎫 Ticket NAVIX - ${ticketData.cliente.nombre}`,
            html: generarHTMLTicket(ticketData),
            attachments
        });

        res.json({
            success: true,
            message: "Email enviado correctamente",
            smtp: {
                messageId: info.messageId,
                accepted: info.accepted,
                rejected: info.rejected,
                response: info.response
            }
        });
    } catch (error) {
        console.error("Error al enviar email:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/api/enviar-tickets-seguimiento", async (req, res) => {
    try {
        const { emailDestino, ticketData, delays } = req.body;

        if (!validarPayloadBasico(emailDestino, ticketData)) {
            return res.status(400).json({ success: false, error: "Faltan datos requeridos" });
        }

        const delayEnCamino = (delays?.enCamino || 0.1) * 60 * 1000;

        const attachments = [];
        const adjuntoFotoCliente = crearAdjuntoInline(ticketData.fotoCliente, "foto-cliente.jpg", "fotoCliente");
        if (adjuntoFotoCliente) attachments.push(adjuntoFotoCliente);

        const infoConfirmacion = await enviarCorreo({
            to: emailDestino,
            subject: `✅ Pedido Confirmado - NAVIX ${ticketData.codigoTicket}`,
            html: generarHTMLTicket(ticketData),
            attachments
        });

        setTimeout(async () => {
            try {
                await enviarCorreo({
                    to: emailDestino,
                    subject: `📦 Su Pedido Está en Camino - NAVIX ${ticketData.codigoTicket}`,
                    html: generarHTMLEnCamino(ticketData)
                });
            } catch (error) {
                console.error("Error al enviar ticket En Camino:", error);
            }
        }, delayEnCamino);

        res.json({
            success: true,
            message: "Tickets programados correctamente",
            smtp: {
                confirmacion: {
                    messageId: infoConfirmacion.messageId,
                    accepted: infoConfirmacion.accepted,
                    rejected: infoConfirmacion.rejected,
                    response: infoConfirmacion.response
                }
            }
        });
    } catch (error) {
        console.error("Error al enviar tickets de seguimiento:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/api/enviar-ticket-entregado", async (req, res) => {
    try {
        const { emailDestino, ticketData, fotoEntrega } = req.body;

        if (!validarPayloadBasico(emailDestino, ticketData)) {
            return res.status(400).json({ success: false, error: "Faltan datos requeridos" });
        }

        const attachments = [];
        const adjuntoFotoEntrega = crearAdjuntoInline(fotoEntrega, "foto-entrega.jpg", "fotoEntrega");
        if (adjuntoFotoEntrega) attachments.push(adjuntoFotoEntrega);

        const info = await enviarCorreo({
            to: emailDestino,
            subject: `✅ Pedido Entregado - NAVIX ${ticketData.codigoTicket}`,
            html: generarHTMLEntregado(ticketData, !!adjuntoFotoEntrega),
            attachments
        });

        res.json({
            success: true,
            message: "Ticket de entregado enviado",
            smtp: {
                messageId: info.messageId,
                accepted: info.accepted,
                rejected: info.rejected,
                response: info.response
            }
        });
    } catch (error) {
        console.error("Error al enviar ticket entregado:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, async () => {
    console.log("════════════════════════════════════════════════════════");
    console.log("  SERVIDOR NAVIX INICIADO CORRECTAMENTE");
    console.log("════════════════════════════════════════════════════════");

    console.log("BREVO_USER:", process.env.BREVO_USER ? "OK" : "FALTA");
    console.log("BREVO_PASS:", process.env.BREVO_PASS ? "OK" : "FALTA");
    console.log("MAIL_FROM:", MAIL_FROM || "FALTA");

    try {
        await transporter.verify();
        console.log("✓ SMTP listo para enviar correos");
    } catch (error) {
        console.error("✗ Error verificando SMTP:", error.message);
    }
});
