"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

const serializeTranscation=(obj) =>{
    const serialized={ ...obj};

    if (obj.balance){
        serialized.balance=obj.balance.toNumber();
    }

    if (obj.amount){
        serialized.amount=obj.amount.toNumber();
    }
    return serialized;
}

export async function updateDefaultAccount(accountId) {
    
    try {
        const {userId}=await auth();
        if(!userId) throw new Error("Unauthorized");
        
        const user=await db.user.findUnique({
            where:{ clerkUserId: userId},
        });
        
        if(!user){
            throw new Error("User not found");
        }

        await db.account.updateMany({
            where:{userId:user.id, isDefault:true},
            data:{isDefault:false},
        });

        const account=await db.account.update({
            where:{
                id:accountId,
                userId:user.id
            },
            data:{isDefault:true}
        });

        revalidatePath("/dashboard");
        return {success:true, data:serializeTranscation(account)};

    } catch (error) {
        return {success:false, error:error.message};
        
    }
}

export async function getAccountWithTransactions(accountId){
    const {userId}=await auth();
    if(!userId) throw new Error("Unauthorized");
        
    const user=await db.user.findUnique({
        where:{ clerkUserId: userId},
    });
        
    if(!user){
        throw new Error("User not found");
    }
    const account=await db.account.findUnique({
        where:{id:accountId, userId:user.id},
        include:{
            transactions:{
                orderBy:{ date:"desc"},
                
            },
            _count:{
                select:{transactions:true}
            }
        }
    });
    if(!account)
        return null;
    return{
        ...serializeTranscation(account),
        transactions: account.transactions.map(serializeTranscation)
    }
}

export async function bulkDeleteTransactions(transactionIds){
    try {
        const {userId}=await auth();
        if(!userId) throw new Error("Unauthorized");
        
        const user=await db.user.findUnique({
            where:{ clerkUserId: userId},
        });
        
        if(!user){
            throw new Error("User not found");
        }
        const transactions=await db.transaction.findMany({
            where:{
                id:{in:transactionIds},
                userId:user.id
            }
        });
        
        const accountBalanceChanges=transaction.reduce((acc, transaction)=>{
            const change=
                transaction.type==="EXPENSE"
                ?transaction.amount
                : -transaction.amount;
            acc[transaction.accountId]=(acc[transaction.accountId]||0)+change;
            return acc;
        },{});

        //Delete transactions and update account balances in a transaction
        await db.$transaction(async(tx)=>{
            // Delete transactions
            await tx.transaction.deleteMany({
                where:{
                    id:{in:transactionIds},
                    userId:user.id
                }
            });

            for(const [accountId, balanceChange] of Object.entries(accountBalanceChanges)){
                await tx.account.update({
                    where:{id:accountId},
                    data:{
                        balance:{
                            increment:balanceChange,
                        }
                    }
                });
            }
        })
        revalidatePath("/dashboard");
        revalidatePath("/account/[id]");
        return {success:true};
    } catch (error) {
        return {success:false, error:error.message};
    }
}