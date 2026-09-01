const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

require('dotenv').config({
    path: path.join(__dirname, '.env'),
    override: true
});

const app = express();

const PORT = 3000;


// ========================================
// MySQL Connection Pool
// ========================================

const db = mysql.createPool({

    host:
        process.env.DB_HOST,

    user:
        process.env.DB_USER,

    password:
        process.env.DB_PASSWORD,

    database:
        process.env.DB_NAME,

    port:
        Number(process.env.DB_PORT),

    waitForConnections:
        true,

    connectionLimit:
        10,

    queueLimit:
        0

});


// ========================================
// Middleware
// ========================================

app.use(
    express.static('public')
);

app.use(
    express.json()
);


// ========================================
// Dashboard API
// ========================================

app.get(
    '/api/dashboard',
    async (req, res) => {

        try {

            // 今日订单
            const [todayResult] =
                await db.query(`

                    SELECT
                        COUNT(*) AS count

                    FROM orders

                    WHERE DATE(collection_date)
                        = CURDATE()

                `);


            // 待处理
            const [pendingResult] =
                await db.query(`

                    SELECT
                        COUNT(*) AS count

                    FROM orders

                    WHERE status = 'pending'

                `);


            // 待取货
            const [readyResult] =
                await db.query(`

                    SELECT
                        COUNT(*) AS count

                    FROM orders

                    WHERE status = 'ready'

                `);


            // 已完成
            const [collectedResult] =
                await db.query(`

                    SELECT
                        COUNT(*) AS count

                    FROM orders

                    WHERE status = 'collected'

                `);


            // 最近订单
            const [recentOrders] =
                await db.query(`

                    SELECT

                        o.order_id,

                        o.phone_number,

                        c.name AS customer_name,

                        o.collection_date,

                        o.status,

                        o.packaging_mode

                    FROM orders o

                    LEFT JOIN customers c
                        ON o.phone_number
                        = c.phone_number

                    ORDER BY
                        o.order_id DESC

                    LIMIT 10

                `);


            res.json({

                todayOrders:
                    Number(
                        todayResult[0].count
                    ),

                pending:
                    Number(
                        pendingResult[0].count
                    ),

                ready:
                    Number(
                        readyResult[0].count
                    ),

                collected:
                    Number(
                        collectedResult[0].count
                    ),

                recentOrders

            });


        } catch (error) {

            console.error(
                'Dashboard API Error:',
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


// ========================================
// 获取月饼种类
// ========================================

app.get(
    '/api/mooncakes',
    async (req, res) => {

        try {

            const [rows] =
                await db.query(`

                    SELECT

                        v.variant_id,

                        v.mooncake_id,

                        v.egg_type_id,

                        v.display_name,

                        m.name AS mooncake_name,

                        e.name AS egg_type

                    FROM mooncake_variants v

                    JOIN mooncakes m
                        ON v.mooncake_id
                        = m.mooncake_id

                    LEFT JOIN egg_types e
                        ON v.egg_type_id
                        = e.egg_type_id

                    WHERE

                        m.is_active = TRUE

                        AND v.is_active = TRUE

                        AND (
                            e.is_active = TRUE
                            OR v.egg_type_id IS NULL
                        )

                    ORDER BY

                        v.mooncake_id,

                        v.egg_type_id

                `);


            res.json(rows);


        } catch (error) {

            console.error(
                '获取月饼失败:',
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


// ========================================
// 创建订单
// ========================================

app.post(
    '/api/orders',
    async (req, res) => {

        const connection =
            await db.getConnection();


        try {

            const {

                customerName,

                phoneNumber,

                collectionDate,

                packagingMode,

                packingNote,

                items,

                boxArrangement

            } = req.body;


            // ========================================
            // 基本验证
            // ========================================

            if (
                !phoneNumber ||
                !phoneNumber.trim()
            ) {

                return res.status(400).json({

                    error:
                        '请输入电话号码'

                });

            }


            if (!collectionDate) {

                return res.status(400).json({

                    error:
                        '请选择取货日期'

                });

            }


            if (
                ![
                    'mixed',
                    'separate',
                    'custom'
                ].includes(packagingMode)
            ) {

                return res.status(400).json({

                    error:
                        '无效的包装方式'

                });

            }


            // ========================================
            // 整理普通 Items
            // ========================================

            const cleanItems =
                Array.isArray(items)

                    ? items
                        .map(item => ({

                            variant_id:
                                Number(
                                    item.variant_id
                                ),

                            quantity:
                                Number(
                                    item.quantity
                                )

                        }))
                        .filter(item =>

                            Number.isInteger(
                                item.variant_id
                            )

                            &&

                            Number.isInteger(
                                item.quantity
                            )

                            &&

                            item.quantity > 0

                        )

                    : [];


            // ========================================
            // Mixed 必须有月饼
            // ========================================

            if (
                packagingMode === 'mixed' &&
                cleanItems.length === 0
            ) {

                return res.status(400).json({

                    error:
                        '请至少选择一种月饼'

                });

            }


            // ========================================
            // Separate 必须有月饼
            //
            // 注意：
            //
            // Separate 不再要求前端一个盒一个盒传。
            //
            // 例如：
            //
            // 白莲蓉 × 10
            //
            // Server 自动变成：
            //
            // 第1盒 ×4
            // 第2盒 ×4
            // 第3盒 ×2
            // ========================================

            if (
                packagingMode === 'separate' &&
                cleanItems.length === 0
            ) {

                return res.status(400).json({

                    error:
                        '请至少选择一种月饼'

                });

            }


            // ========================================
            // Custom 必须有盒子
            // ========================================

            if (
                packagingMode === 'custom' &&
                (
                    !Array.isArray(
                        boxArrangement
                    )
                    ||
                    boxArrangement.length === 0
                )
            ) {

                return res.status(400).json({

                    error:
                        '请至少安排一个盒子'

                });

            }


            // ========================================
            // 开始 Transaction
            // ========================================

            await connection.beginTransaction();


            // ========================================
            // Customer
            // ========================================

            await connection.query(`

                INSERT INTO customers (

                    phone_number,

                    name

                )

                VALUES (?, ?)

                ON DUPLICATE KEY UPDATE

                    name =
                        CASE

                            WHEN
                                VALUES(name)
                                IS NOT NULL

                                AND

                                VALUES(name)
                                <> ''

                            THEN
                                VALUES(name)

                            ELSE
                                name

                        END

            `, [

                phoneNumber.trim(),

                customerName &&
                customerName.trim()

                    ? customerName.trim()

                    : null

            ]);


            // ========================================
            // 收集所有 variant ID
            // ========================================

            const allVariantIds =
                new Set();


            cleanItems.forEach(
                item => {

                    allVariantIds.add(
                        item.variant_id
                    );

                }
            );


            if (
                Array.isArray(
                    boxArrangement
                )
            ) {

                boxArrangement.forEach(
                    box => {

                        if (
                            Array.isArray(
                                box.items
                            )
                        ) {

                            box.items.forEach(
                                item => {

                                    const id =
                                        Number(
                                            item.variant_id
                                        );


                                    if (
                                        Number.isInteger(
                                            id
                                        )
                                    ) {

                                        allVariantIds.add(
                                            id
                                        );

                                    }

                                }
                            );

                        }

                    }
                );

            }


            const variantIds =
                [...allVariantIds];


            if (
                variantIds.length === 0
            ) {

                throw new Error(
                    '订单中没有有效的月饼资料。'
                );

            }


            // ========================================
            // 检查 Variant 是否存在
            // ========================================

            const placeholders =
                variantIds
                    .map(() => '?')
                    .join(',');


            const [variants] =
                await connection.query(`

                    SELECT
                        variant_id

                    FROM mooncake_variants

                    WHERE

                        variant_id IN (
                            ${placeholders}
                        )

                        AND is_active = TRUE

                `, variantIds);


            if (
                variants.length
                !==
                variantIds.length
            ) {

                throw new Error(
                    '订单中包含不存在或已经停用的月饼。'
                );

            }


            // ========================================
            // 创建 Order
            // ========================================

            const [orderResult] =
                await connection.query(`

                    INSERT INTO orders (

                        phone_number,

                        collection_date,

                        status,

                        packaging_mode,

                        packing_note

                    )

                    VALUES (

                        ?,

                        ?,

                        'pending',

                        ?,

                        ?

                    )

                `, [

                    phoneNumber.trim(),

                    collectionDate,

                    packagingMode,

                    packingNote &&
                    packingNote.trim()

                        ? packingNote.trim()

                        : null

                ]);


            const orderId =
                orderResult.insertId;


            // ========================================
            // MIXED
            //
            // 只保存总数量
            // ========================================

            if (
                packagingMode === 'mixed'
            ) {

                for (
                    const item
                    of cleanItems
                ) {

                    await connection.query(`

                        INSERT INTO order_items (

                            order_id,

                            item_type,

                            variant_id,

                            quantity

                        )

                        VALUES (

                            ?,

                            'variant',

                            ?,

                            ?

                        )

                    `, [

                        orderId,

                        item.variant_id,

                        item.quantity

                    ]);

                }

            }


            // ========================================
            // SEPARATE
            //
            // 每盒一种口味
            //
            // 自动每盒最多 4 粒
            // ========================================

            else if (
                packagingMode === 'separate'
            ) {

                let boxNumber = 1;


                for (
                    const item
                    of cleanItems
                ) {

                    let remaining =
                        item.quantity;


                    // ====================================
                    // 自动拆盒
                    // ====================================

                    while (
                        remaining > 0
                    ) {

                        const quantity =
                            Math.min(
                                remaining,
                                4
                            );


                        // 创建盒子
                        const [boxResult] =
                            await connection.query(`

                                INSERT INTO order_boxes (

                                    order_id,

                                    box_number

                                )

                                VALUES (?, ?)

                            `, [

                                orderId,

                                boxNumber

                            ]);


                        const boxId =
                            boxResult.insertId;


                        // 放入月饼
                        await connection.query(`

                            INSERT INTO box_items (

                                box_id,

                                variant_id,

                                quantity

                            )

                            VALUES (?, ?, ?)

                        `, [

                            boxId,

                            item.variant_id,

                            quantity

                        ]);


                        remaining -=
                            quantity;


                        boxNumber++;

                    }

                }

            }


            // ========================================
            // CUSTOM
            //
            // 完全按照客户指定
            // ========================================

            else if (
                packagingMode === 'custom'
            ) {

                let boxNumber = 1;


                for (
                    const box
                    of boxArrangement
                ) {

                    if (
                        !Array.isArray(
                            box.items
                        )
                        ||
                        box.items.length === 0
                    ) {

                        throw new Error(
                            `第 ${boxNumber} 盒没有月饼`
                        );

                    }


                    // ====================================
                    // 计算这盒总数量
                    // ====================================

                    const totalQuantity =
                        box.items.reduce(

                            (
                                total,
                                item
                            ) => {

                                return (
                                    total
                                    +
                                    Number(
                                        item.quantity || 0
                                    )
                                );

                            },

                            0

                        );


                    // ====================================
                    // 每盒最多 4 粒
                    // ====================================

                    if (
                        totalQuantity > 4
                    ) {

                        throw new Error(

                            `第 ${boxNumber} 盒超过 4 粒月饼。`
                            +
                            `每盒最多只能放 4 粒。`

                        );

                    }


                    // ====================================
                    // 建立盒子
                    // ====================================

                    const [boxResult] =
                        await connection.query(`

                            INSERT INTO order_boxes (

                                order_id,

                                box_number

                            )

                            VALUES (?, ?)

                        `, [

                            orderId,

                            boxNumber

                        ]);


                    const boxId =
                        boxResult.insertId;


                    // ====================================
                    // 放入每种月饼
                    // ====================================

                    for (
                        const item
                        of box.items
                    ) {

                        const variantId =
                            Number(
                                item.variant_id
                            );

                        const quantity =
                            Number(
                                item.quantity
                            );


                        if (

                            !Number.isInteger(
                                variantId
                            )

                            ||

                            !Number.isInteger(
                                quantity
                            )

                            ||

                            quantity <= 0

                        ) {

                            throw new Error(

                                `第 ${boxNumber} 盒有无效的月饼资料。`

                            );

                        }


                        await connection.query(`

                            INSERT INTO box_items (

                                box_id,

                                variant_id,

                                quantity

                            )

                            VALUES (?, ?, ?)

                        `, [

                            boxId,

                            variantId,

                            quantity

                        ]);

                    }


                    boxNumber++;

                }

            }


            // ========================================
            // 完成 Transaction
            // ========================================

            await connection.commit();


            res.json({

                success:
                    true,

                message:
                    '订单创建成功',

                orderId:
                    orderId

            });


        } catch (error) {

            await connection.rollback();


            console.error(
                '创建订单失败:',
                error
            );


            res.status(500).json({

                success:
                    false,

                error:
                    error.message

            });


        } finally {

            connection.release();

        }

    }
);


// ========================================
// 获取订单列表
// ========================================

app.get(
    '/api/orders',
    async (req, res) => {

        try {

            const {
                collection_date
            } = req.query;


            let sql = `

                SELECT

                    o.order_id,

                    o.phone_number,

                    c.name AS customer_name,

                    o.collection_date,

                    o.status,

                    o.packaging_mode

                FROM orders o

                LEFT JOIN customers c

                    ON o.phone_number
                    = c.phone_number

            `;


            const params = [];


            // ====================================
            // 日期筛选
            // ====================================

            if (
                collection_date
            ) {

                sql += `

                    WHERE
                        DATE(o.collection_date)
                        = ?

                `;

                params.push(
                    collection_date
                );

            }


            // ====================================
            // 最新订单优先
            // ====================================

            sql += `

                ORDER BY
                    o.order_id DESC

            `;


            const [orders] =
                await db.query(
                    sql,
                    params
                );


            res.json(
                orders
            );


        } catch (error) {

            console.error(
                '获取订单列表失败:',
                error
            );


            res.status(500).json({

                error:
                    '无法获取订单列表'

            });

        }

    }
);


// ========================================
// 获取单个订单详情
// ========================================

app.get(
    '/api/orders/:id',
    async (req, res) => {

        try {

            const orderId =
                Number(
                    req.params.id
                );


            if (
                !Number.isInteger(
                    orderId
                )
            ) {

                return res.status(400).json({

                    error:
                        '无效的订单编号'

                });

            }


            // ====================================
            // Order
            // ====================================

            const [orders] =
                await db.query(`

                    SELECT

                        o.order_id,

                        o.phone_number,

                        c.name AS customer_name,

                        o.order_date,

                        o.collection_date,

                        o.status,

                        o.packaging_mode,

                        o.packing_note

                    FROM orders o

                    LEFT JOIN customers c

                        ON o.phone_number
                        = c.phone_number

                    WHERE
                        o.order_id = ?

                `, [

                    orderId

                ]);


            if (
                orders.length === 0
            ) {

                return res.status(404).json({

                    error:
                        '找不到这个订单'

                });

            }


            // ====================================
            // 普通 Order Items
            // ====================================

            const [items] =
                await db.query(`

                    SELECT

                        oi.order_item_id,

                        oi.variant_id,

                        oi.quantity,

                        v.display_name

                    FROM order_items oi

                    JOIN mooncake_variants v

                        ON oi.variant_id
                        = v.variant_id

                    WHERE
                        oi.order_id = ?

                    ORDER BY
                        oi.order_item_id

                `, [

                    orderId

                ]);


            // ====================================
            // Box Items
            // ====================================

            const [boxes] =
                await db.query(`

                    SELECT

                        ob.box_id,

                        ob.box_number,

                        bi.box_item_id,

                        bi.variant_id,

                        bi.quantity,

                        v.display_name

                    FROM order_boxes ob

                    JOIN box_items bi

                        ON ob.box_id
                        = bi.box_id

                    JOIN mooncake_variants v

                        ON bi.variant_id
                        = v.variant_id

                    WHERE
                        ob.order_id = ?

                    ORDER BY

                        ob.box_number,

                        bi.box_item_id

                `, [

                    orderId

                ]);


            // ====================================
            // 返回
            // ====================================

            res.json({

                order:
                    orders[0],

                items,

                boxes

            });


        } catch (error) {

            console.error(
                '获取订单详情失败:',
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


// ========================================
// 更新订单状态
// ========================================

app.put(
    '/api/orders/:id/status',
    async (req, res) => {

        const orderId =
            Number(
                req.params.id
            );

        const {
            status
        } = req.body;


        const allowedStatus = [

            'pending',

            'ready',

            'collected'

        ];


        if (
            !Number.isInteger(
                orderId
            )
        ) {

            return res.status(400).json({

                error:
                    '无效的订单编号'

            });

        }


        if (
            !allowedStatus.includes(
                status
            )
        ) {

            return res.status(400).json({

                error:
                    '无效的订单状态'

            });

        }


        try {

            const [result] =
                await db.query(`

                    UPDATE orders

                    SET
                        status = ?

                    WHERE
                        order_id = ?

                `, [

                    status,

                    orderId

                ]);


            if (
                result.affectedRows === 0
            ) {

                return res.status(404).json({

                    error:
                        '找不到这个订单'

                });

            }


            res.json({

                success:
                    true,

                message:
                    '订单状态更新成功'

            });


        } catch (error) {

            console.error(
                '更新订单状态失败:',
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


// ========================================
// 删除订单
// ========================================
//
// DELETE /api/orders/:id
//
// 删除：
// 1. box_items
// 2. order_boxes
// 3. order_items
// 4. orders
//
// 不删除 customers
// ========================================

app.delete(
    '/api/orders/:id',
    async (req, res) => {

        const orderId =
            Number(
                req.params.id
            );


        const connection =
            await db.getConnection();


        try {

            if (
                !Number.isInteger(
                    orderId
                )
            ) {

                return res.status(400).json({

                    error:
                        '无效的订单编号'

                });

            }


            await connection.beginTransaction();


            // ====================================
            // 删除 Box Items
            // ====================================

            await connection.query(`

                DELETE bi

                FROM box_items bi

                INNER JOIN order_boxes ob

                    ON bi.box_id
                    = ob.box_id

                WHERE
                    ob.order_id = ?

            `, [

                orderId

            ]);


            // ====================================
            // 删除 Boxes
            // ====================================

            await connection.query(`

                DELETE FROM order_boxes

                WHERE
                    order_id = ?

            `, [

                orderId

            ]);


            // ====================================
            // 删除普通 Items
            // ====================================

            await connection.query(`

                DELETE FROM order_items

                WHERE
                    order_id = ?

            `, [

                orderId

            ]);


            // ====================================
            // 删除 Order
            // ====================================

            const [result] =
                await connection.query(`

                    DELETE FROM orders

                    WHERE
                        order_id = ?

                `, [

                    orderId

                ]);


            if (
                result.affectedRows === 0
            ) {

                throw new Error(
                    '找不到这个订单'
                );

            }


            await connection.commit();


            res.json({

                success:
                    true,

                message:
                    '订单删除成功'

            });


        } catch (error) {

            await connection.rollback();


            console.error(
                '删除订单失败:',
                error
            );


            res.status(500).json({

                success:
                    false,

                error:
                    error.message

            });


        } finally {

            connection.release();

        }

    }
);


// ========================================
// 每日月饼统计
// ========================================
//
// GET
// /api/daily-summary?date=2026-09-05
//
// Mixed
//   ↓
// order_items
//
// Separate / Custom
//   ↓
// box_items
//
// 最后 UNION ALL 后统一统计
// ========================================

app.get(
    '/api/daily-summary',
    async (req, res) => {

        try {

            const selectedDate =
                req.query.date;


            // ====================================
            // 日期验证
            // ====================================

            if (

                !selectedDate

                ||

                !/^\d{4}-\d{2}-\d{2}$/
                    .test(
                        selectedDate
                    )

            ) {

                return res.status(400).json({

                    error:
                        '请输入有效日期，例如 2026-09-05'

                });

            }


            // ====================================
            // 当天订单数量
            // ====================================

            const [orderRows] =
                await db.query(`

                    SELECT
                        COUNT(*) AS order_count

                    FROM orders

                    WHERE
                        DATE(collection_date)
                        = ?

                `, [

                    selectedDate

                ]);


            // ====================================
            // 月饼统计
            // ====================================

            const [rows] =
                await db.query(`

                    SELECT

                        x.variant_id,

                        v.display_name,

                        SUM(
                            x.quantity
                        ) AS total_quantity

                    FROM (

                        /* ==========================
                           Mixed
                        ========================== */

                        SELECT

                            oi.variant_id,

                            oi.quantity

                        FROM order_items oi

                        INNER JOIN orders o

                            ON oi.order_id
                            = o.order_id

                        WHERE

                            DATE(
                                o.collection_date
                            )
                            = ?


                        UNION ALL


                        /* ==========================
                           Separate + Custom
                        ========================== */

                        SELECT

                            bi.variant_id,

                            bi.quantity

                        FROM box_items bi

                        INNER JOIN order_boxes ob

                            ON bi.box_id
                            = ob.box_id

                        INNER JOIN orders o

                            ON ob.order_id
                            = o.order_id

                        WHERE

                            DATE(
                                o.collection_date
                            )
                            = ?

                    ) x

                    INNER JOIN mooncake_variants v

                        ON x.variant_id
                        = v.variant_id

                    GROUP BY

                        x.variant_id,

                        v.display_name

                    ORDER BY

                        x.variant_id

                `, [

                    selectedDate,

                    selectedDate

                ]);


            // ====================================
            // 转换成数字
            // ====================================

            const items =
                rows.map(
                    row => ({

                        variant_id:
                            Number(
                                row.variant_id
                            ),

                        display_name:
                            row.display_name,

                        total_quantity:
                            Number(
                                row.total_quantity
                            )

                    })
                );


            // ====================================
            // 总月饼数量
            // ====================================

            const totalMooncakes =
                items.reduce(

                    (
                        total,
                        item
                    ) => {

                        return (
                            total
                            +
                            item.total_quantity
                        );

                    },

                    0

                );


            // ====================================
            // 返回
            // ====================================

            res.json({

                date:
                    selectedDate,

                orderCount:
                    Number(
                        orderRows[0]
                            .order_count
                    ),

                totalMooncakes,

                items

            });


        } catch (error) {

            console.error(
                '每日月饼统计失败:',
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


// ========================================
// Test Database
// ========================================

app.get(
    '/api/test-db',
    async (req, res) => {

        try {

            const [rows] =
                await db.query(`

                    SELECT
                        1 AS test

                `);


            res.json({

                success:
                    true,

                message:
                    'MySQL 连接成功',

                result:
                    rows

            });


        } catch (error) {

            console.error(
                'Database Test Error:',
                error
            );


            res.status(500).json({

                success:
                    false,

                error:
                    error.message

            });

        }

    }
);


// ========================================
// Root
// ========================================

app.get(
    '/',
    (req, res) => {

        res.sendFile(

            path.join(
                __dirname,
                'public',
                'index.html'
            )

        );

    }
);


// ========================================
// Start Server
// ========================================

app.listen(
    PORT,
    () => {

        console.log(
            `服务器已经启动：http://localhost:${PORT}`
        );

    }
);