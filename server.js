const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

//Se configura el gmail para el envío de emails
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
  socketTimeout: 20000
});


app.post('/api/enviar-ticket', async (req, res) => {
    try {
        const { emailDestino, ticketData } = req.body;

        if (!emailDestino || !ticketData) {
            return res.status(400).json({ 
                success: false, 
                error: 'Faltan datos requeridos' 
            });
        }

        //Se manda a generar el HTML del ticket
        const htmlTicket = generarHTMLTicket(ticketData);

        //Configurar el email con el que se harán los envíos de tickets
        const mailOptions = {
            from: {
                name: 'NAVIX - Sistema de Tickets',
                address: process.env.EMAIL_USER
            },
            to: emailDestino,
            subject: `🎫 Ticket NAVIX - ${ticketData.cliente.nombre}`,
            html: htmlTicket,
            attachments: []
        };

        //Si existe la foto del cliente, se agrega para ser mostrada en el HTML
        if (ticketData.fotoCliente) {
            
            const base64Data = ticketData.fotoCliente.split(',')[1] || ticketData.fotoCliente;
            
            mailOptions.attachments.push({
                filename: 'foto-cliente.jpg',
                content: base64Data,
                encoding: 'base64',
                cid: 'fotoCliente'
            });
        }

        //Aquí se realiza el envio del email
        const info = await transporter.sendMail(mailOptions);
        
        console.log(`Email enviado a ${emailDestino}`);
        
        res.json({ 
            success: true, 
            message: 'Email enviado correctamente',
            messageId: info.messageId
        });

    } catch (error) {
        console.error('Error al enviar email:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Nuevo endpoint para enviar los 3 tickets con seguimiento
app.post('/api/enviar-tickets-seguimiento', async (req, res) => {
    try {
        const { emailDestino, ticketData, delays } = req.body;

        if (!emailDestino || !ticketData) {
            return res.status(400).json({ 
                success: false, 
                error: 'Faltan datos requeridos' 
            });
        }

        // Delays por defecto (en minutos convertidos a milisegundos)
        const delayEnCamino = (delays?.enCamino || 0.1) * 60 * 1000; // default: 6 segundos
        const delayEntregado = (delays?.entregado || 0.1) * 60 * 1000; // default: 6 segundos

        console.log(`Iniciando envío de tickets de seguimiento a ${emailDestino}`);

        // 1. Enviar ticket de confirmación inmediatamente
        const htmlConfirmacion = generarHTMLTicket(ticketData);
        const mailOptionsConfirmacion = {
            from: {
                name: 'NAVIX - Sistema de Tickets',
                address: process.env.EMAIL_USER
            },
            to: emailDestino,
            subject: `✅ Pedido Confirmado - NAVIX ${ticketData.codigoTicket}`,
            html: htmlConfirmacion,
            attachments: []
        };

        if (ticketData.fotoCliente) {
            const base64Data = ticketData.fotoCliente.split(',')[1] || ticketData.fotoCliente;
            mailOptionsConfirmacion.attachments.push({
                filename: 'foto-cliente.jpg',
                content: base64Data,
                encoding: 'base64',
                cid: 'fotoCliente'
            });
        }

        await transporter.sendMail(mailOptionsConfirmacion);
        console.log(`✓ Ticket de CONFIRMACIÓN enviado`);

        // 2. Programar envío de "En Camino" después del delay
        setTimeout(async () => {
            try {
                const htmlEnCamino = generarHTMLEnCamino(ticketData);
                const mailOptionsEnCamino = {
                    from: {
                        name: 'NAVIX - Sistema de Tickets',
                        address: process.env.EMAIL_USER
                    },
                    to: emailDestino,
                    subject: `📦 Su Pedido Está en Camino - NAVIX ${ticketData.codigoTicket}`,
                    html: htmlEnCamino
                };
                
                await transporter.sendMail(mailOptionsEnCamino);
                console.log(`✓ Ticket EN CAMINO enviado`);
            } catch (error) {
                console.error('Error al enviar ticket En Camino:', error);
            }
        }, delayEnCamino);

        // 3. Programar envío de "Entregado" después del segundo delay
        setTimeout(async () => {
            try {
                const htmlEntregado = generarHTMLEntregado(ticketData);
                const mailOptionsEntregado = {
                    from: {
                        name: 'NAVIX - Sistema de Tickets',
                        address: process.env.EMAIL_USER
                    },
                    to: emailDestino,
                    subject: `✅ Su Pedido Ha Sido Entregado - NAVIX ${ticketData.codigoTicket}`,
                    html: htmlEntregado
                };
                
                await transporter.sendMail(mailOptionsEntregado);
                console.log(`✓ Ticket ENTREGADO enviado`);
            } catch (error) {
                console.error('Error al enviar ticket Entregado:', error);
            }
        }, delayEnCamino + delayEntregado);

        res.json({ 
            success: true, 
            message: 'Tickets programados correctamente',
            delays: {
                confirmacion: 'Enviado inmediatamente',
                enCamino: `${delays?.enCamino || 0.1} minutos`,
                entregado: `${(delays?.enCamino || 0.1) + (delays?.entregado || 0.1)} minutos`
            }
        });

    } catch (error) {
        console.error('Error al enviar tickets de seguimiento:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

//Se genera el HTML del ticket
function generarHTMLTicket(data) {
    const formatMXN = (n) => {
        return (typeof n === 'number' && !isNaN(n)) 
            ? n.toLocaleString("es-MX", { style: "currency", currency: "MXN" })
            : "$0.00";
    };

    let productosHTML = '';
    let subtotalProductos = 0;

    //Generar sección de productos por proveedor
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

    //Aquí van los costos fijos de la ruta, se usa en el HTML principal
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
    ` : '';

    //HTML del email de CONFIRMACIÓN
    return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Ticket NAVIX</title>
        </head>
        <body style="margin:0;padding:20px;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f5f5f5;">
            <div style="max-width:650px;margin:0 auto;background:white;padding:30px;border-radius:16px;box-shadow:0 10px 35px rgba(0,0,0,0.15);border-left:8px solid #995E8E;">
                
                <!-- Header -->
                <h2 style="color:#8b4e7f;text-align:center;margin-top:0;font-size:24px;">
                    🎫 Ticket de Registro — NAVIX
                </h2>
                
                <!-- Foto del Cliente (si existe) -->
                ${data.fotoCliente ? `
                <div style="text-align:center;margin:20px 0;">
                    <img src="cid:fotoCliente" 
                         alt="Foto del Cliente" 
                         style="width:130px;height:130px;border-radius:12px;object-fit:cover;box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                </div>
                ` : ''}
                
                <!-- Detalles del Registro -->
                <div style="margin-top:25px;">
                    <div style="font-weight:bold;font-size:16px;color:#6b3570;border-bottom:2px solid #e8d4f0;padding-bottom:5px;margin-bottom:10px;">
                        📋 Detalles del Registro
                    </div>
                    <div style="background:#faf5ff;padding:12px 14px;border-radius:10px;border-left:4px solid #995E8E;margin-bottom:14px;font-size:13px;">
                        <strong>Fecha y Hora:</strong> ${new Date().toLocaleString("es-MX")}<br>
                        <strong>Proveedores:</strong> ${data.totalProveedores}<br>
                        <strong>Productos:</strong> ${data.totalProductos}<br>
                        <strong>Kilómetros Totales:</strong> ${data.totalKm}
                    </div>
                </div>

                <!-- Costos Fijos -->
                ${costosFijosHTML}

                <!-- Datos del Cliente -->
                <div style="margin-top:20px;">
                    <div style="font-weight:bold;font-size:16px;color:#6b3570;border-bottom:2px solid #e8d4f0;padding-bottom:5px;margin-bottom:10px;">
                        👤 Datos del Cliente
                    </div>
                    <div style="background:#faf5ff;padding:12px 14px;border-radius:10px;border-left:4px solid #995E8E;margin-bottom:14px;font-size:13px;">
                        <strong>Nombre:</strong> ${data.cliente.nombre}<br>
                        <strong>Teléfono:</strong> ${data.cliente.telefono}<br>
                        <strong>Email:</strong> ${data.cliente.email}<br>
                        <strong>Dirección:</strong> ${data.cliente.direccion}<br>
                        <strong>Notas:</strong> ${data.cliente.notas || "Ninguna"}
                    </div>
                </div>

                <!-- Proveedores y Productos -->
                <div style="margin-top:20px;">
                    <div style="font-weight:bold;font-size:16px;color:#6b3570;border-bottom:2px solid #e8d4f0;padding-bottom:5px;margin-bottom:10px;">
                        📦 Proveedores y Productos
                    </div>
                    ${productosHTML}
                </div>

                <!-- Totales -->
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

                <!-- Código de Ticket -->
                <div style="background:#f0f0f0;padding:15px;border-radius:10px;border-left:4px solid #995E8E;text-align:center;margin-top:15px;">
                    <div style="font-weight:bold;font-size:14px;color:#6b3570;margin-bottom:5px;">
                        📋 CÓDIGO DE TICKET
                    </div>
                    <div style="font-size:20px;font-weight:bold;color:#995E8E;letter-spacing:3px;">
                        ${data.codigoTicket}
                    </div>
                </div>

                <!-- Footer -->
                <div style="margin-top:30px;padding-top:15px;border-top:1px solid #e0e0e0;text-align:center;font-size:12px;color:#999;">
                    <p>Este es un ticket generado automáticamente por el sistema NAVIX</p>
                    <p>📧 Para cualquier consulta, responde a este email</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

//Generar HTML del ticket "EN CAMINO"
function generarHTMLEnCamino(data) {
    const formatMXN = (n) => {
        return (typeof n === 'number' && !isNaN(n)) 
            ? n.toLocaleString("es-MX", { style: "currency", currency: "MXN" })
            : "$0.00";
    };

    return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Pedido En Camino - NAVIX</title>
        </head>
        <body style="margin:0;padding:20px;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f5f5f5;">
            <div style="max-width:650px;margin:0 auto;background:white;padding:30px;border-radius:16px;box-shadow:0 10px 35px rgba(0,0,0,0.15);border-left:8px solid #4A90E2;">
                
                <!-- Header -->
                <h2 style="color:#4A90E2;text-align:center;margin-top:0;font-size:26px;">
                    📦 Su Pedido Está en Camino
                </h2>
                
                <!-- Barra de Progreso -->
                <div style="margin:30px 0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;position:relative;">
                        <!-- Línea de progreso -->
                        <div style="position:absolute;top:15px;left:0;right:0;height:4px;background:#e0e0e0;z-index:1;"></div>
                        <div style="position:absolute;top:15px;left:0;width:50%;height:4px;background:#4A90E2;z-index:2;"></div>
                        
                        <!-- Estado 1: Confirmado -->
                        <div style="display:flex;flex-direction:column;align-items:center;z-index:3;background:white;padding:0 10px;">
                            <div style="width:32px;height:32px;border-radius:50%;background:#4A90E2;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:18px;">✓</div>
                            <div style="margin-top:8px;font-size:13px;font-weight:bold;color:#4A90E2;">Confirmado</div>
                        </div>
                        
                        <!-- Estado 2: En Camino -->
                        <div style="display:flex;flex-direction:column;align-items:center;z-index:3;background:white;padding:0 10px;">
                            <div style="width:32px;height:32px;border-radius:50%;background:#4A90E2;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:18px;">📦</div>
                            <div style="margin-top:8px;font-size:13px;font-weight:bold;color:#4A90E2;">En Camino</div>
                        </div>
                        
                        <!-- Estado 3: Entregado -->
                        <div style="display:flex;flex-direction:column;align-items:center;z-index:3;background:white;padding:0 10px;">
                            <div style="width:32px;height:32px;border-radius:50%;background:#e0e0e0;display:flex;align-items:center;justify-content:center;color:#999;font-weight:bold;font-size:18px;">○</div>
                            <div style="margin-top:8px;font-size:13px;color:#999;">Entregado</div>
                        </div>
                    </div>
                </div>

                <!-- Mensaje Principal -->
                <div style="background:#f0f8ff;padding:20px;border-radius:10px;border-left:4px solid #4A90E2;margin:25px 0;">
                    <p style="margin:0;font-size:16px;color:#333;line-height:1.6;">
                        ¡Buenas noticias, <strong>${data.cliente.nombre}</strong>! 🎉<br><br>
                        Su pedido ha salido de nuestras instalaciones y está en camino hacia su dirección.<br>
                        Nuestro equipo está trabajando para entregarle sus productos en las mejores condiciones.
                    </p>
                </div>

                <!-- Información del Pedido -->
                <div style="margin-top:25px;">
                    <div style="font-weight:bold;font-size:16px;color:#4A90E2;border-bottom:2px solid #d4e8f0;padding-bottom:5px;margin-bottom:10px;">
                        📋 Información del Pedido
                    </div>
                    <div style="background:#faf5ff;padding:14px;border-radius:10px;border-left:4px solid #995E8E;font-size:14px;">
                        <strong>Código de Ticket:</strong> <span style="color:#995E8E;font-size:18px;font-weight:bold;letter-spacing:1px;">${data.codigoTicket}</span><br><br>
                        <strong>Cliente:</strong> ${data.cliente.nombre}<br>
                        <strong>Dirección de Entrega:</strong> ${data.cliente.direccion}<br>
                        <strong>Teléfono:</strong> ${data.cliente.telefono}<br>
                        <strong>Total del Pedido:</strong> ${formatMXN(data.totalGeneral)}<br>
                        <strong>Productos:</strong> ${data.totalProductos} artículos de ${data.totalProveedores} proveedores
                    </div>
                </div>

                <!-- Información de Contacto -->
                <div style="margin-top:25px;background:#fff9f0;padding:15px;border-radius:10px;border-left:4px solid #F08BB0;">
                    <p style="margin:0;font-size:13px;color:#555;">
                        💡 <strong>¿Tienes alguna pregunta?</strong><br>
                        Puedes responder a este correo o contactarnos al teléfono de atención al cliente.
                    </p>
                </div>

                <!-- Footer -->
                <div style="margin-top:30px;padding-top:15px;border-top:1px solid #e0e0e0;text-align:center;font-size:12px;color:#999;">
                    <p>Este es un correo automático del sistema NAVIX</p>
                    <p>Te mantendremos informado sobre el estado de tu pedido</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

//Generar HTML del ticket "ENTREGADO"
function generarHTMLEntregado(data) {
    const formatMXN = (n) => {
        return (typeof n === 'number' && !isNaN(n)) 
            ? n.toLocaleString("es-MX", { style: "currency", currency: "MXN" })
            : "$0.00";
    };

    return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Pedido Entregado - NAVIX</title>
        </head>
        <body style="margin:0;padding:20px;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f5f5f5;">
            <div style="max-width:650px;margin:0 auto;background:white;padding:30px;border-radius:16px;box-shadow:0 10px 35px rgba(0,0,0,0.15);border-left:8px solid #28a745;">
                
                <!-- Header -->
                <h2 style="color:#28a745;text-align:center;margin-top:0;font-size:26px;">
                    ✅ ¡Pedido Entregado con Éxito!
                </h2>
                
                <!-- Barra de Progreso Completa -->
                <div style="margin:30px 0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;position:relative;">
                        <!-- Línea de progreso completa -->
                        <div style="position:absolute;top:15px;left:0;right:0;height:4px;background:#28a745;z-index:1;"></div>
                        
                        <!-- Estado 1: Confirmado -->
                        <div style="display:flex;flex-direction:column;align-items:center;z-index:3;background:white;padding:0 10px;">
                            <div style="width:32px;height:32px;border-radius:50%;background:#28a745;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:18px;">✓</div>
                            <div style="margin-top:8px;font-size:13px;font-weight:bold;color:#28a745;">Confirmado</div>
                        </div>
                        
                        <!-- Estado 2: En Camino -->
                        <div style="display:flex;flex-direction:column;align-items:center;z-index:3;background:white;padding:0 10px;">
                            <div style="width:32px;height:32px;border-radius:50%;background:#28a745;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:18px;">✓</div>
                            <div style="margin-top:8px;font-size:13px;font-weight:bold;color:#28a745;">En Camino</div>
                        </div>
                        
                        <!-- Estado 3: Entregado -->
                        <div style="display:flex;flex-direction:column;align-items:center;z-index:3;background:white;padding:0 10px;">
                            <div style="width:32px;height:32px;border-radius:50%;background:#28a745;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:18px;">✓</div>
                            <div style="margin-top:8px;font-size:13px;font-weight:bold;color:#28a745;">Entregado</div>
                        </div>
                    </div>
                </div>

                <!-- Mensaje Principal -->
                <div style="background:#f0fff4;padding:20px;border-radius:10px;border-left:4px solid #28a745;margin:25px 0;">
                    <p style="margin:0;font-size:16px;color:#333;line-height:1.6;">
                        🎉 <strong>¡Excelente noticia, ${data.cliente.nombre}!</strong><br><br>
                        Su pedido ha sido entregado exitosamente en la dirección indicada.<br>
                        Esperamos que disfrute de sus productos y agradecemos su confianza en NAVIX.
                    </p>
                </div>

                <!-- Información del Pedido -->
                <div style="margin-top:25px;">
                    <div style="font-weight:bold;font-size:16px;color:#28a745;border-bottom:2px solid #d4f0db;padding-bottom:5px;margin-bottom:10px;">
                        📋 Resumen del Pedido Entregado
                    </div>
                    <div style="background:#faf5ff;padding:14px;border-radius:10px;border-left:4px solid #995E8E;font-size:14px;">
                        <strong>Código de Ticket:</strong> <span style="color:#995E8E;font-size:18px;font-weight:bold;letter-spacing:1px;">${data.codigoTicket}</span><br><br>
                        <strong>Cliente:</strong> ${data.cliente.nombre}<br>
                        <strong>Dirección de Entrega:</strong> ${data.cliente.direccion}<br>
                        <strong>Total del Pedido:</strong> ${formatMXN(data.totalGeneral)}<br>
                        <strong>Productos Entregados:</strong> ${data.totalProductos} artículos
                    </div>
                </div>

                <!-- Agradecimiento -->
                <div style="margin-top:25px;background:#fff9f0;padding:20px;border-radius:10px;border-left:4px solid #F08BB0;text-align:center;">
                    <p style="margin:0;font-size:15px;color:#555;line-height:1.6;">
                        ⭐ <strong>¡Gracias por su preferencia!</strong><br><br>
                        Esperamos que haya tenido una excelente experiencia con NAVIX.<br>
                        Si tiene algún comentario o sugerencia, no dude en contactarnos.
                    </p>
                </div>

                <!-- Footer -->
                <div style="margin-top:30px;padding-top:15px;border-top:1px solid #e0e0e0;text-align:center;font-size:12px;color:#999;">
                    <p>Este es un correo automático del sistema NAVIX</p>
                    <p>📧 Para cualquier consulta, responde a este email</p>
                    <p style="margin-top:10px;color:#28a745;font-weight:bold;">¡Esperamos volver a servirle pronto!</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

app.get('/', (req, res) => {
    res.json({ 
        message: 'Servidor NAVIX corriendo correctamente',
        endpoints: [
            'POST /api/enviar-ticket',
            'POST /api/enviar-tickets-seguimiento'
        ]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log('  SERVIDOR NAVIX INICIADO CORRECTAMENTE');
    console.log('════════════════════════════════════════════════════════');
});
